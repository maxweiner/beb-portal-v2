// POST /api/white-sheets/pages/signed-url
//
// Body: { page_id: uuid }
// Returns: { signed_url: string, expires_in_sec: number }
//
// The white-sheets bucket is private; the review pile UI needs a
// short-lived signed URL it can drop into an <iframe src=...> for
// browser-native PDF preview. We mint a 30-minute URL on demand —
// long enough to work through a review pile, short enough that a
// leaked URL is mostly defanged.
//
// Auth: bearer-token authed internal user. Role-gated to match the
// list/confirm routes.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { blockIfImpersonating } from '@/lib/impersonation/server'

export const dynamic = 'force-dynamic'

const BLOCKED_ROLES = new Set(['pending', 'marketing_partner'])
const BUCKET = 'white-sheets'
const SIGNED_URL_TTL_SEC = 30 * 60  // 30 minutes

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

  // Look up the page so we can sign the storage path we actually
  // own. (The caller passes page_id, not a raw storage path —
  // prevents path-traversal / cross-event signing.)
  const { data: page } = await sb
    .from('white_sheet_pages')
    .select('id, page_pdf_path, status, created_at')
    .eq('id', page_id)
    .maybeSingle()
  if (!page) {
    return NextResponse.json({ error: 'page_not_found' }, { status: 404 })
  }
  if (!(page as any).page_pdf_path) {
    // Phase 9: the 90-day cleanup cron purges per-page PDFs for
    // settled rows but keeps the DB row + OCR result. The signed-
    // URL caller (review pile re-open after 90 days) gets a
    // distinct 410 Gone so the UI can show a clear "preview
    // expired" state instead of a generic 404.
    return NextResponse.json({
      error: 'page_pdf_expired',
      message: 'Per-page PDF preview was purged after 90 days. The OCR data + audit trail remain on this page.',
      status: (page as any).status,
      created_at: (page as any).created_at,
    }, { status: 410 })
  }

  const { data: signed, error: signErr } = await sb.storage
    .from(BUCKET)
    .createSignedUrl((page as any).page_pdf_path, SIGNED_URL_TTL_SEC)
  if (signErr || !signed?.signedUrl) {
    return NextResponse.json({ error: 'sign_failed', detail: signErr?.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    signed_url: signed.signedUrl,
    expires_in_sec: SIGNED_URL_TTL_SEC,
  })
}
