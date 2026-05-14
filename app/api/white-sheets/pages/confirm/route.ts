// POST /api/white-sheets/pages/confirm
//
// Body: {
//   page_id: uuid,
//   fields: {            // operator-edited values, all optional;
//     first_name, last_name, address_line_1, city, state, zip,
//     phone, email, date_of_birth, lead_source,
//     lead_source_other_text, items_description,
//     id_number,
//     amount, check_number, buy_form_number, transaction_date,
//     buyer_user_id, initials_confidence
//   }
// }
//
// Operator-driven confirmation from the review pile:
//   1. Merge the edited values into ocr_raw (so the page row's
//      record reflects the operator's truth, not the raw OCR).
//   2. Run the white-sheet customer dedup + write helper (same
//      one the Phase 3 auto-commit path uses, just driven by
//      operator-edited fields instead of raw OCR).
//   3. Set buyer_user_id + initials_classifier_confidence if the
//      operator picked a buyer (Phase 5 will do this from the
//      classifier; Phase 4 supports the manual path).
//   4. Flip status to 'auto_committed' (the page is no longer in
//      the review pile from this operator's POV) + stamp
//      reviewed_at + reviewed_by_user_id.
//   5. Re-balance the parent upload's counters
//      (pages_in_review -1, pages_auto_committed +1).
//
// Idempotent on retry: if the page is already in 'auto_committed'
// we no-op and return ok.
//
// Auth: bearer-token authed internal user. Same role gating as
// the upload route.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { blockIfImpersonating } from '@/lib/impersonation/server'
import { dedupAndUpsertWhiteSheetCustomer } from '@/lib/white-sheets/customerWrite'
import type { WhiteSheetOcrResult } from '@/lib/white-sheets/ocr'

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

/** Build a WhiteSheetOcrResult-shaped record from operator-edited
 *  fields so dedupAndUpsertWhiteSheetCustomer can consume it
 *  unchanged. Confidence is forced to 1.0 because the operator
 *  vouched for each value. */
function ocrFromOperatorFields(fields: any): WhiteSheetOcrResult {
  const wrap = (v: any) => (v === undefined || v === null || v === '') ? undefined : { value: v, confidence: 1.0 }
  return {
    buy_form_number:        wrap(fields.buy_form_number),
    check_number:           wrap(fields.check_number),
    amount:                 wrap(typeof fields.amount === 'number' ? fields.amount : Number(fields.amount) || null),
    transaction_date:       wrap(fields.transaction_date),
    first_name:             wrap(fields.first_name),
    last_name:              wrap(fields.last_name),
    address_line_1:         wrap(fields.address_line_1),
    city:                   wrap(fields.city),
    state:                  wrap(fields.state),
    zip:                    wrap(fields.zip),
    phone:                  wrap(fields.phone),
    email:                  wrap(fields.email),
    date_of_birth:          wrap(fields.date_of_birth),
    id_number:              wrap(fields.id_number),
    lead_source:            wrap(fields.lead_source),
    lead_source_other_text: wrap(fields.lead_source_other_text),
    items_description:      wrap(fields.items_description),
    cost_cents: 0,
    raw_text: '',
  } as WhiteSheetOcrResult
}

export async function POST(req: Request) {
  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }
  const { page_id, fields } = body || {}
  if (!isUuid(page_id)) return NextResponse.json({ error: 'page_id_required' }, { status: 400 })
  if (!fields || typeof fields !== 'object') return NextResponse.json({ error: 'fields_required' }, { status: 400 })

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
  const reviewerId = (userRow as any).id

  // Pull the page + its upload context (brand, store_id, start_date).
  const { data: page } = await sb
    .from('white_sheet_pages')
    .select(`
      id, upload_id, event_id, status, review_reasons, ocr_raw, buyer_check_id
    `)
    .eq('id', page_id)
    .maybeSingle()
  if (!page) return NextResponse.json({ error: 'page_not_found' }, { status: 404 })

  // Idempotent: a duplicate POST after a successful confirm is a no-op.
  if ((page as any).status === 'auto_committed') {
    return NextResponse.json({ ok: true, already_confirmed: true })
  }

  const { data: upload } = await sb
    .from('white_sheet_uploads')
    .select('id, event_id, events!inner(store_id, start_date)')
    .eq('id', (page as any).upload_id)
    .maybeSingle()
  const storeId: string | null  = (upload as any)?.events?.store_id  ?? null
  const startDate: string | null = (upload as any)?.events?.start_date ?? null

  if (!storeId) {
    return NextResponse.json({ error: 'store_not_resolvable' }, { status: 500 })
  }

  // ── 1. Customer dedup + write ─────────────────────────────
  const synthesizedOcr = ocrFromOperatorFields(fields)
  const customerResult = await dedupAndUpsertWhiteSheetCustomer({
    storeId,
    eventStartDate: startDate,
    ocr: synthesizedOcr,
  })

  // ── 2. Update the page row ─────────────────────────────────
  // We snapshot the operator-edited values into ocr_raw under an
  // 'operator_overrides' key so the original Claude response stays
  // intact for debugging / model-version comparisons. Confidence
  // pills in the UI will read from ocr_raw.<field>.confidence so
  // the snapshot keeps the OCR-vs-operator distinction visible.
  const existingOcr = (page as any).ocr_raw || {}
  const mergedOcr = {
    ...existingOcr,
    operator_overrides: fields,
    operator_confirmed_at: new Date().toISOString(),
  }

  const pagePatch: Record<string, any> = {
    status: 'auto_committed',
    review_reasons: [],
    ocr_raw: mergedOcr,
    buy_form_number_ocr: fields.buy_form_number ?? (existingOcr as any)?.buy_form_number?.value ?? null,
    check_number_ocr:    fields.check_number    ?? (existingOcr as any)?.check_number?.value    ?? null,
    amount_ocr:          (typeof fields.amount === 'number' ? fields.amount : Number(fields.amount)) || (existingOcr as any)?.amount?.value || null,
    id_number_raw:       fields.id_number       ?? (existingOcr as any)?.id_number?.value       ?? null,
    items_raw:           fields.items_description ?? (existingOcr as any)?.items_description?.value ?? null,
    customer_id:         customerResult.customer_id,
    reviewed_by_user_id: reviewerId,
    reviewed_at:         new Date().toISOString(),
  }
  if (isUuid(fields.buyer_user_id)) {
    pagePatch.buyer_user_id = fields.buyer_user_id
    if (typeof fields.initials_confidence === 'number') {
      pagePatch.initials_classifier_confidence = fields.initials_confidence
    } else {
      // Manual classification by the operator — count it as full
      // confidence so Phase 5's classifier can ignore it as a
      // not-needing-retrain sample.
      pagePatch.initials_classifier_confidence = 1.0
    }
  }

  const { error: updErr } = await sb
    .from('white_sheet_pages')
    .update(pagePatch)
    .eq('id', page_id)
  if (updErr) {
    return NextResponse.json({ error: 'page_update_failed', detail: updErr.message }, { status: 500 })
  }

  // ── 3. Re-balance the parent upload's counters ─────────────
  // The page was in 'needs_review' before, so pages_in_review needs
  // to decrement and pages_auto_committed needs to increment. We
  // read-modify-write because Supabase JS doesn't surface increment.
  const { data: u } = await sb
    .from('white_sheet_uploads')
    .select('pages_in_review, pages_auto_committed, pages_errored')
    .eq('id', (page as any).upload_id)
    .maybeSingle()
  if (u) {
    // If the page was in 'errored' before (rare — operator
    // resolving an errored page via this confirm endpoint), pull
    // the decrement from pages_errored instead.
    const decFromErrored = (page as any).status === 'errored'
    const next: Record<string, number> = {
      pages_auto_committed: ((u as any).pages_auto_committed || 0) + 1,
    }
    if (decFromErrored) next.pages_errored = Math.max(0, ((u as any).pages_errored || 0) - 1)
    else                next.pages_in_review = Math.max(0, ((u as any).pages_in_review || 0) - 1)

    await sb.from('white_sheet_uploads').update(next).eq('id', (page as any).upload_id)
  }

  return NextResponse.json({
    ok: true,
    page_id,
    customer_id: customerResult.customer_id,
    customer_action: customerResult.action,
    matched_via: customerResult.matched_via,
  })
}
