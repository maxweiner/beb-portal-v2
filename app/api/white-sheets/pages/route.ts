// GET /api/white-sheets/pages?event_id=<uuid>
//
// Returns the review pile for one event: every white_sheet_pages
// row in status 'needs_review' or 'errored', oldest first. The
// review pile UI (components/whitesheets/WhiteSheetReviewPile.tsx)
// renders this as a left-sidebar list with the detail viewer on
// the right.
//
// Includes the OCR-extracted fields + review reasons + the
// matched buyer_check (when one was linked) so the detail pane
// can show "Entered: $1250.00 / OCR: $1205.00" side-by-side
// without a second round-trip.
//
// Auth: bearer-token authed internal user. Roles allowed match the
// upload route — 'pending' and 'marketing_partner' are excluded.

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

export async function GET(req: Request) {
  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  const { searchParams } = new URL(req.url)
  const eventId = searchParams.get('event_id')
  if (!isUuid(eventId)) {
    return NextResponse.json({ error: 'event_id_required' }, { status: 400 })
  }

  // Verify the caller via the Authorization bearer token.
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

  // Pull pages with associated upload + matched buyer_check (if
  // any). The needs_review + errored union covers everything the
  // operator should see — auto_committed rows are silent.
  const { data: pages, error } = await sb
    .from('white_sheet_pages')
    .select(`
      id, upload_id, event_id, page_number, page_pdf_path,
      status, review_reasons,
      ocr_raw,
      buy_form_number_ocr, check_number_ocr, amount_ocr,
      id_number_raw, items_raw,
      buyer_check_id, customer_id,
      buyer_user_id, initials_classifier_confidence,
      attempts, last_error, processed_at, created_at
    `)
    .eq('event_id', eventId)
    .in('status', ['needs_review', 'errored'])
    .order('upload_id', { ascending: true })
    .order('page_number', { ascending: true })
  if (error) {
    return NextResponse.json({ error: 'query_failed', detail: error.message }, { status: 500 })
  }

  // Pull the matched buyer_checks rows in one trip so the detail
  // view can show entered amount / check# side-by-side with OCR.
  const checkIds = Array.from(new Set(
    (pages || []).map(p => (p as any).buyer_check_id).filter(Boolean),
  )) as string[]
  let checksById: Record<string, any> = {}
  if (checkIds.length > 0) {
    const { data: checks } = await sb
      .from('buyer_checks')
      .select('id, amount, check_number, buy_form_number, payment_type, commission_rate, day_number')
      .in('id', checkIds)
    for (const c of (checks || [])) {
      checksById[(c as any).id] = c
    }
  }

  // Surface the upload's filename + status so the sidebar can group
  // pages by their upload (useful when multiple PDFs landed for
  // the same event).
  const uploadIds = Array.from(new Set((pages || []).map(p => (p as any).upload_id)))
  let uploadsById: Record<string, any> = {}
  if (uploadIds.length > 0) {
    const { data: uploads } = await sb
      .from('white_sheet_uploads')
      .select('id, original_filename, status, pages_total, pages_in_review, pages_auto_committed, pages_errored, created_at')
      .in('id', uploadIds)
    for (const u of (uploads || [])) {
      uploadsById[(u as any).id] = u
    }
  }

  return NextResponse.json({
    ok: true,
    pages: pages || [],
    checks_by_id: checksById,
    uploads_by_id: uploadsById,
  })
}
