// POST /api/white-sheets/uploads/finalize
//
// Body: {
//   event_id:         uuid
//   upload_id:        uuid  (client-generated, used as the storage folder name)
//   source_pdf_path:  string (verified to start with `{brand}/{event_id}/{upload_id}/source.pdf`)
//   original_filename: string
// }
//
// The client uploaded the PDF directly to the white-sheets bucket
// using supabase-js + the user's authed session (RLS gates by
// has_any_role — see supabase-migration-white-sheets-phase-1-schema.sql).
// This route's job is just to create the white_sheet_uploads row
// in status='splitting' so the cron picks it up.
//
// Auth: any active internal user. We rely on storage.objects RLS
// to have already blocked the upload itself for ineligible roles;
// here we double-check the actor exists and isn't pending /
// marketing_partner.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { blockIfImpersonating } from '@/lib/impersonation/server'

export const dynamic = 'force-dynamic'

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

const BLOCKED_ROLES = new Set(['pending', 'marketing_partner'])

export async function POST(req: Request) {
  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }

  const { event_id, upload_id, source_pdf_path, original_filename } = body || {}
  if (!isUuid(event_id))         return NextResponse.json({ error: 'event_id_required' },        { status: 400 })
  if (!isUuid(upload_id))        return NextResponse.json({ error: 'upload_id_required' },       { status: 400 })
  if (typeof source_pdf_path !== 'string' || source_pdf_path.length === 0) {
    return NextResponse.json({ error: 'source_pdf_path_required' }, { status: 400 })
  }

  // Verify the caller via the Authorization bearer token. We need
  // both the role check + a denormalized brand for the upload row.
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
  if (!userRow) return NextResponse.json({ error: 'user_not_found' }, { status: 401 })
  if (BLOCKED_ROLES.has((userRow as any).role)) {
    return NextResponse.json({ error: 'role_not_allowed' }, { status: 403 })
  }

  // Look up the event for its brand (and verify it exists).
  const { data: ev } = await sb
    .from('events')
    .select('id, brand')
    .eq('id', event_id)
    .maybeSingle()
  if (!ev) return NextResponse.json({ error: 'event_not_found' }, { status: 404 })

  // Defensive: the path must live under {brand}/{event_id}/{upload_id}/source.pdf.
  // Prevents a caller from finalizing an upload that's actually
  // stored somewhere else (e.g., another event's folder).
  const expectedPrefix = `${(ev as any).brand}/${event_id}/${upload_id}/`
  if (!source_pdf_path.startsWith(expectedPrefix) || !source_pdf_path.endsWith('.pdf')) {
    return NextResponse.json(
      { error: 'source_pdf_path_invalid', expected_prefix: expectedPrefix },
      { status: 400 },
    )
  }

  // Insert the upload row. ID is client-supplied so the storage
  // path and DB row stay aligned even after retries.
  const { data: row, error: insError } = await sb
    .from('white_sheet_uploads')
    .insert({
      id: upload_id,
      event_id,
      brand: (ev as any).brand,
      uploaded_by_user_id: (userRow as any).id,
      source_pdf_path,
      original_filename: typeof original_filename === 'string' ? original_filename : null,
      status: 'splitting',
    })
    .select()
    .single()
  if (insError) {
    // Conflict on the PK means the client retried after a previous
    // 200 — treat as success and return the existing row.
    if (insError.code === '23505') {
      const { data: existing } = await sb
        .from('white_sheet_uploads')
        .select('*')
        .eq('id', upload_id)
        .maybeSingle()
      if (existing) return NextResponse.json({ ok: true, upload: existing })
    }
    return NextResponse.json({ error: 'insert_failed', detail: insError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, upload: row })
}
