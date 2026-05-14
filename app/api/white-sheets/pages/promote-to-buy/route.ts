// POST /api/white-sheets/pages/promote-to-buy
//
// Body: {
//   page_id: uuid,
//   buy_row: {
//     day_number: number,            // 1-indexed day of the event
//     check_number: string,
//     buy_form_number: string,       // typically copied from OCR
//     amount: number,                // dollars (will be rounded)
//     payment_type: string,          // usually 'check'
//     commission_rate: 0 | 5 | 10,
//     commission_note?: string,
//   },
//   fields: { ... }                  // same payload as /confirm
// }
//
// For pages flagged 'unmatched_form': the operator is telling us
// "yes this is a real buy, here are the values, create the
// buyer_checks row from the OCR". Steps:
//
//   1. Insert the new buyer_checks row. The AFTER INSERT trigger
//      from Phase 1 will auto-relink any orphan white_sheet_pages
//      whose buy_form_number_ocr matches, but we're not relying on
//      that here — we explicitly set this page's buyer_check_id to
//      the new row's id so the operator's intent is honored even if
//      the form# OCR was wrong.
//   2. Hand off to the same /confirm flow internally: customer
//      dedup write + page flip + counter rebalance.
//
// Auth: bearer-token authed internal user.

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

/** Mirror of the helper in /confirm — synthesizes a
 *  WhiteSheetOcrResult from operator-edited fields for the
 *  customer dedup writer. */
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
  const { page_id, buy_row, fields } = body || {}
  if (!isUuid(page_id)) return NextResponse.json({ error: 'page_id_required' }, { status: 400 })
  if (!buy_row || typeof buy_row !== 'object') return NextResponse.json({ error: 'buy_row_required' }, { status: 400 })
  if (!fields || typeof fields !== 'object')   return NextResponse.json({ error: 'fields_required' },  { status: 400 })

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

  // Pull the page + upload context.
  const { data: page } = await sb
    .from('white_sheet_pages')
    .select('id, upload_id, event_id, status, ocr_raw, page_pdf_path')
    .eq('id', page_id)
    .maybeSingle()
  if (!page) return NextResponse.json({ error: 'page_not_found' }, { status: 404 })

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

  // ── 1. Insert the buyer_checks row ─────────────────────────
  const dayNumber = Number(buy_row.day_number)
  if (!Number.isFinite(dayNumber) || dayNumber < 1) {
    return NextResponse.json({ error: 'day_number_required' }, { status: 400 })
  }
  const checkNumber  = String(buy_row.check_number || '').trim()
  const formNumber   = String(buy_row.buy_form_number || '').trim()
  const amountInt    = Math.round(Number(buy_row.amount) || 0)
  const paymentType  = String(buy_row.payment_type || 'check').trim()
  const commissionRate = buy_row.commission_rate === 5 ? 5 : buy_row.commission_rate === 0 ? 0 : 10
  const commissionNote = (commissionRate === 5 || commissionRate === 0)
    ? (String(buy_row.commission_note || '').trim() || null)
    : null

  if (!checkNumber || !formNumber || amountInt <= 0) {
    return NextResponse.json({ error: 'buy_row_invalid', detail: 'check_number, buy_form_number, and amount > 0 are required' }, { status: 400 })
  }

  const { data: newCheck, error: checkErr } = await sb
    .from('buyer_checks')
    .insert({
      entry_id: null,
      event_id: (page as any).event_id,
      day_number: dayNumber,
      check_number: checkNumber,
      buy_form_number: formNumber,
      amount: amountInt,
      payment_type: paymentType,
      commission_rate: commissionRate,
      commission_note: commissionNote,
    })
    .select('id')
    .single()
  if (checkErr || !newCheck?.id) {
    return NextResponse.json({ error: 'buyer_check_insert_failed', detail: checkErr?.message }, { status: 500 })
  }

  // Note: the AFTER INSERT trigger trg_relink_orphan_white_sheets
  // may have ALREADY set this page's buyer_check_id to newCheck.id
  // (if buy_form_number_ocr matched). That's fine — the explicit
  // update below is idempotent.

  // ── 2. Customer dedup + write ─────────────────────────────
  const synthesizedOcr = ocrFromOperatorFields(fields)
  const customerResult = await dedupAndUpsertWhiteSheetCustomer({
    storeId,
    eventStartDate: startDate,
    ocr: synthesizedOcr,
  })

  // ── 3. Update the page row + flip status ──────────────────
  const existingOcr = (page as any).ocr_raw || {}
  const mergedOcr = {
    ...existingOcr,
    operator_overrides: fields,
    operator_promoted_to_buy: true,
    operator_confirmed_at: new Date().toISOString(),
  }

  const pagePatch: Record<string, any> = {
    status: 'auto_committed',
    review_reasons: [],
    ocr_raw: mergedOcr,
    buy_form_number_ocr: fields.buy_form_number ?? formNumber,
    check_number_ocr:    fields.check_number    ?? checkNumber,
    amount_ocr:          (typeof fields.amount === 'number' ? fields.amount : Number(fields.amount)) || amountInt,
    id_number_raw:       fields.id_number       ?? null,
    items_raw:           fields.items_description ?? null,
    buyer_check_id:      newCheck.id,
    customer_id:         customerResult.customer_id,
    reviewed_by_user_id: reviewerId,
    reviewed_at:         new Date().toISOString(),
  }
  if (isUuid(fields.buyer_user_id)) {
    pagePatch.buyer_user_id = fields.buyer_user_id
    pagePatch.initials_classifier_confidence = typeof fields.initials_confidence === 'number'
      ? fields.initials_confidence
      : 1.0
  }

  const { error: updErr } = await sb
    .from('white_sheet_pages')
    .update(pagePatch)
    .eq('id', page_id)
  if (updErr) {
    return NextResponse.json({ error: 'page_update_failed', detail: updErr.message }, { status: 500 })
  }

  // ── 3b. Bootstrap user_signature_samples (Phase 5) ─────────
  // Same insert as /confirm — when the operator picks a buyer,
  // save the page PDF as a reference sample for the closed-set
  // classifier. Idempotent on (user_id, source_page_id).
  if (isUuid(fields.buyer_user_id) && (page as any).page_pdf_path) {
    const { data: existingSample } = await sb
      .from('user_signature_samples')
      .select('id')
      .eq('source_page_id', page_id)
      .eq('user_id', fields.buyer_user_id)
      .maybeSingle()
    if (!existingSample) {
      const { error: sampleErr } = await sb
        .from('user_signature_samples')
        .insert({
          user_id: fields.buyer_user_id,
          image_path: (page as any).page_pdf_path,
          source_page_id: page_id,
          is_active: true,
        })
      if (sampleErr) console.warn('[whiteSheets.promote] signature sample insert failed', sampleErr.message)
    }
  }

  // ── 4. Rebalance upload counters ──────────────────────────
  const { data: u } = await sb
    .from('white_sheet_uploads')
    .select('pages_in_review, pages_auto_committed, pages_errored')
    .eq('id', (page as any).upload_id)
    .maybeSingle()
  if (u) {
    const decFromErrored = (page as any).status === 'errored'
    const next: Record<string, number> = {
      pages_auto_committed: ((u as any).pages_auto_committed || 0) + 1,
    }
    if (decFromErrored) next.pages_errored   = Math.max(0, ((u as any).pages_errored   || 0) - 1)
    else                next.pages_in_review = Math.max(0, ((u as any).pages_in_review || 0) - 1)
    await sb.from('white_sheet_uploads').update(next).eq('id', (page as any).upload_id)
  }

  return NextResponse.json({
    ok: true,
    page_id,
    buyer_check_id: newCheck.id,
    customer_id: customerResult.customer_id,
    customer_action: customerResult.action,
    matched_via: customerResult.matched_via,
  })
}
