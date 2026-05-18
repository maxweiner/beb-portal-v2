// POST /api/white-sheets/pages/retry
//
// Body: { page_id: uuid }
//
// Operator-driven retry for an errored white-sheet page. Flips
// status='errored' → 'pending', clears last_error + processed_at,
// and decrements the parent upload's pages_errored counter so the
// cron tick can re-claim the page and re-run OCR. Re-OCR'd result
// repopulates the appropriate counter (auto_committed / in_review /
// errored) via the normal worker path.
//
// `attempts` is NOT reset — it's part of the row's history and the
// claim RPC will continue incrementing it. The 429-retry budget
// (MAX_429_ATTEMPTS in lib/white-sheets/process.ts) respects that
// history so a chronically rate-limited page eventually settles
// in errored rather than looping forever.
//
// Idempotent: if the page is already 'pending' the call no-ops.
// Status outside { errored, pending } returns 409 so the operator
// can't accidentally retry a needs_review or auto_committed page
// (those have a normal Confirm flow).
//
// Auth: bearer-token authed internal user. Same role gating as the
// confirm + upload routes.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { blockIfImpersonating } from '@/lib/impersonation/server'

export const dynamic = 'force-dynamic'

const BLOCKED_ROLES = new Set(['pending', 'marketing_partner'])

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

function isUuid(s: unknown): s is string {
  return typeof s === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

export async function POST(req: Request) {
  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }
  const { page_id } = body || {}
  if (!isUuid(page_id)) return NextResponse.json({ error: 'page_id_required' }, { status: 400 })

  const authHeader = req.headers.get('authorization') || ''
  const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!accessToken) return NextResponse.json({ error: 'auth_required' }, { status: 401 })

  const sb = admin()
  const userClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${accessToken}` } } },
  )
  const { data: userResp } = await userClient.auth.getUser()
  const authUid = userResp?.user?.id
  if (!authUid) return NextResponse.json({ error: 'auth_invalid' }, { status: 401 })

  const { data: userRow } = await sb
    .from('users')
    .select('id, role')
    .eq('auth_id', authUid)
    .maybeSingle()
  if (!userRow || BLOCKED_ROLES.has((userRow as any).role)) {
    return NextResponse.json({ error: 'role_not_allowed' }, { status: 403 })
  }

  const { data: page } = await sb
    .from('white_sheet_pages')
    .select('id, upload_id, status, page_pdf_path')
    .eq('id', page_id)
    .maybeSingle()
  if (!page) return NextResponse.json({ error: 'page_not_found' }, { status: 404 })

  const currentStatus = (page as any).status
  if (currentStatus === 'pending') {
    return NextResponse.json({ ok: true, already_pending: true })
  }
  if (currentStatus !== 'errored') {
    return NextResponse.json(
      { error: 'page_not_errored', current_status: currentStatus },
      { status: 409 },
    )
  }
  if (!(page as any).page_pdf_path) {
    return NextResponse.json({ error: 'no_page_pdf_to_retry' }, { status: 409 })
  }

  const { error: updErr } = await sb
    .from('white_sheet_pages')
    .update({
      status: 'pending',
      last_error: null,
      processed_at: null,
    })
    .eq('id', page_id)
  if (updErr) {
    return NextResponse.json({ error: 'page_update_failed', detail: updErr.message }, { status: 500 })
  }

  // Decrement the upload's pages_errored counter so the eventual
  // re-run lands in the right bucket without double-counting. We
  // read-modify-write because Supabase JS doesn't surface an
  // increment call — same pattern as bumpUploadCounters in
  // lib/white-sheets/process.ts.
  const { data: u } = await sb
    .from('white_sheet_uploads')
    .select('pages_errored')
    .eq('id', (page as any).upload_id)
    .maybeSingle()
  if (u) {
    await sb
      .from('white_sheet_uploads')
      .update({ pages_errored: Math.max(0, ((u as any).pages_errored || 0) - 1) })
      .eq('id', (page as any).upload_id)
  }

  return NextResponse.json({ ok: true, page_id })
}
