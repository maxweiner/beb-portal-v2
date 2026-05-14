// Customer dedup + write for white-sheet OCR.
//
// Adapted from lib/intake/customerDedup.ts with these differences:
//   - Phone-first → email → create (the intake helper goes
//     license → phone → email → name; we skip license entirely
//     because DL # stays on white_sheet_pages.id_number_raw per
//     the spec's PII-isolation decision).
//   - Service-role client (no user session in the cron context).
//   - Non-destructive merge: on a hit, fill ONLY null columns from
//     the OCR. We never overwrite a value already present.
//   - Always push last_contact_date forward to the event's
//     start_date (so engagement-tier math freshens).
//
// In Phase 3 this helper is wired into the orchestrator's auto-
// commit branch. Since every Phase 3 page lands in needs_review
// (initials_pending), the helper is effectively dormant until
// Phase 5. Kept in this PR anyway so Phase 4 (operator confirm)
// can import it without re-deriving the merge logic.

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { WhiteSheetOcrResult } from './ocr'

let _admin: SupabaseClient | null = null
function admin(): SupabaseClient {
  if (_admin) return _admin
  _admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
  return _admin
}

export interface CustomerWriteInput {
  /** Per-store dedup scope. Resolved from the event's store_id. */
  storeId: string
  /** Drives last_contact_date — the event's start date. */
  eventStartDate: string | null
  /** The OCR extraction result from ocrWhiteSheetPage. */
  ocr: WhiteSheetOcrResult
}

export interface CustomerWriteResult {
  customer_id: string | null
  /** 'merge' = existing row found and filled-in; 'create' = new row
   *  inserted; 'skipped' = not enough OCR'd identity to safely write. */
  action: 'merge' | 'create' | 'skipped'
  /** When 'merge' or 'create', the dedup signal that matched
   *  (phone / email / null on create). */
  matched_via: 'phone' | 'email' | null
}

function normalizePhone(p: string | null | undefined): string | null {
  if (!p) return null
  const d = String(p).replace(/\D/g, '')
  // Drop a leading US country code 1 — schema's phone_normalized
  // generated column does the same regexp_replace dance.
  if (d.length === 11 && d.startsWith('1')) return d.slice(1)
  if (d.length === 10) return d
  return null  // unparseable as a US phone — leave it
}

function normalizeEmail(e: string | null | undefined): string | null {
  if (!e) return null
  const t = String(e).trim().toLowerCase()
  return t.length > 0 && t.includes('@') ? t : null
}

function trimOrNull(s: string | null | undefined): string | null {
  if (!s) return null
  const t = String(s).trim()
  return t.length > 0 ? t : null
}

/** Map the OCR'd lead_source to the customer_how_did_you_hear enum.
 *  Unknown / "other" → null + push the free-text to
 *  how_did_you_hear_other_text. */
function mapLeadSource(ocrLeadSource: string | null | undefined): {
  enum_value: string | null
  other_text: string | null
} {
  if (!ocrLeadSource) return { enum_value: null, other_text: null }
  const v = String(ocrLeadSource).toLowerCase().trim().replace(/[\s\-]+/g, '_')
  // The existing customer_how_did_you_hear enum values per
  // supabase-migration-customers-how-heard-options.sql:
  //   newspaper / large_postcard / small_postcard / email / text /
  //   the_store_told_me / other
  // Plus our Phase 1 spec asks for direct_mail / social_media /
  // referral → fall through to 'other' with the text preserved.
  const direct: Record<string, string> = {
    newspaper: 'newspaper',
    large_postcard: 'large_postcard',
    small_postcard: 'small_postcard',
    postcard: 'large_postcard',  // legacy default
    email: 'email',
    text: 'text',
    the_store_told_me: 'the_store_told_me',
  }
  if (direct[v]) return { enum_value: direct[v], other_text: null }
  // Fall through — the OCR's category lands in the free-text field.
  return { enum_value: 'other', other_text: ocrLeadSource }
}

/** Find-or-create a customers row for an OCR result and return its
 *  id. Non-destructive on match — fills in only null columns. */
export async function dedupAndUpsertWhiteSheetCustomer(
  input: CustomerWriteInput,
): Promise<CustomerWriteResult> {
  const sb = admin()
  const { storeId, eventStartDate, ocr } = input

  if (!storeId) return { customer_id: null, action: 'skipped', matched_via: null }
  if (ocr.unparseable) return { customer_id: null, action: 'skipped', matched_via: null }

  const phone = normalizePhone(ocr.phone?.value)
  const email = normalizeEmail(ocr.email?.value)
  const firstName = trimOrNull(ocr.first_name?.value)
  const lastName  = trimOrNull(ocr.last_name?.value)

  // Need at LEAST a name pair to write a row — the customers table
  // requires first_name + last_name NOT NULL. White-sheet pages
  // without a legible name shouldn't auto-create a junk row; they
  // route to the review pile and the operator decides.
  if (!firstName || !lastName) {
    return { customer_id: null, action: 'skipped', matched_via: null }
  }

  // ── 1. Lookup priority: phone → email ──────────────────────
  // Per spec decision #5 — handwritten emails are OCR-unreliable
  // so we lead with phone.

  if (phone) {
    const { data: byPhone } = await sb
      .from('customers')
      .select('id, address_line_1, city, state, zip, phone, email, date_of_birth, how_did_you_hear')
      .eq('store_id', storeId)
      .eq('phone_normalized', phone)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle()
    if (byPhone?.id) {
      await mergeFill(sb, byPhone, ocr, eventStartDate)
      return { customer_id: byPhone.id, action: 'merge', matched_via: 'phone' }
    }
  }

  if (email) {
    const { data: byEmail } = await sb
      .from('customers')
      .select('id, address_line_1, city, state, zip, phone, email, date_of_birth, how_did_you_hear')
      .eq('store_id', storeId)
      .eq('email_normalized', email)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle()
    if (byEmail?.id) {
      await mergeFill(sb, byEmail, ocr, eventStartDate)
      return { customer_id: byEmail.id, action: 'merge', matched_via: 'email' }
    }
  }

  // ── 2. No match — create a new row ─────────────────────────
  const lead = mapLeadSource(ocr.lead_source?.value)
  const insertPayload: Record<string, any> = {
    store_id: storeId,
    first_name: firstName,
    last_name: lastName,
    phone: ocr.phone?.value ?? null,
    email: ocr.email?.value ?? null,
    date_of_birth: ocr.date_of_birth?.value ?? null,
    address_line_1: ocr.address_line_1?.value ?? null,
    city:  ocr.city?.value  ?? null,
    state: ocr.state?.value ?? null,
    zip:   ocr.zip?.value   ?? null,
    last_contact_date: eventStartDate || null,
  }
  if (lead.enum_value) insertPayload.how_did_you_hear = lead.enum_value
  if (lead.other_text) insertPayload.how_did_you_hear_other_text = lead.other_text

  const { data: created, error: insErr } = await sb
    .from('customers')
    .insert(insertPayload)
    .select('id')
    .single()
  if (insErr || !created?.id) {
    console.warn('[whiteSheets.customerWrite] insert failed', insErr)
    return { customer_id: null, action: 'skipped', matched_via: null }
  }
  return { customer_id: created.id, action: 'create', matched_via: null }
}

/** Non-destructive UPDATE: only fill columns that are currently
 *  null on the matched row. Always push last_contact_date.
 *  Mirrors the intake helper's behavior. */
async function mergeFill(
  sb: SupabaseClient,
  existing: any,
  ocr: WhiteSheetOcrResult,
  eventStartDate: string | null,
) {
  const patch: Record<string, any> = {}
  if (!existing.address_line_1 && ocr.address_line_1?.value) patch.address_line_1 = ocr.address_line_1.value
  if (!existing.city           && ocr.city?.value)           patch.city           = ocr.city.value
  if (!existing.state          && ocr.state?.value)          patch.state          = ocr.state.value
  if (!existing.zip            && ocr.zip?.value)            patch.zip            = ocr.zip.value
  if (!existing.phone          && ocr.phone?.value)          patch.phone          = ocr.phone.value
  if (!existing.email          && ocr.email?.value)          patch.email          = ocr.email.value
  if (!existing.date_of_birth  && ocr.date_of_birth?.value)  patch.date_of_birth  = ocr.date_of_birth.value
  if (!existing.how_did_you_hear) {
    const lead = mapLeadSource(ocr.lead_source?.value)
    if (lead.enum_value) patch.how_did_you_hear = lead.enum_value
    if (lead.other_text) patch.how_did_you_hear_other_text = lead.other_text
  }

  // Always nudge last_contact_date forward — useful for engagement
  // scoring even when we don't fill anything else in.
  if (eventStartDate) {
    patch.last_contact_date = eventStartDate
    patch.updated_at = new Date().toISOString()
  }

  if (Object.keys(patch).length === 0) return

  const { error } = await sb.from('customers').update(patch).eq('id', existing.id)
  if (error) console.warn('[whiteSheets.customerWrite] merge fill failed', error)
}
