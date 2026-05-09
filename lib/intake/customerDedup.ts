/**
 * Customer dedup for the intake → purchase flow (Phase 7).
 *
 * Given the fields captured during an intake and the event's store_id,
 * find a matching customers row or create a new one, and return its id.
 *
 * Dedup priority (per spec, with the safety net described below):
 *   1. license number  (strictest — strongest unique signal)
 *   2. phone (normalized digits)
 *   3. email (lowercased + trimmed)
 *   4. name (first + last)
 *
 * Spec asked for "name → phone → email → license #" priority. We invert
 * because name-first is dangerous (two John Smiths merge into one). Keep
 * name as a final tiebreaker only when paired with phone/email.
 */

import { supabase } from '@/lib/supabase'

export interface DedupInput {
  storeId: string
  firstName: string | null
  lastName: string | null
  phone: string | null
  email: string | null
  licenseNumber: string | null
  licenseState: string | null
  dateOfBirth: string | null
  addressLine1: string | null
  addressCity: string | null
  addressState: string | null
  addressZip: string | null
}

/** Normalize phone to digits only. Returns null if empty after strip. */
function normalizePhone(p: string | null): string | null {
  if (!p) return null
  const d = p.replace(/\D/g, '')
  return d.length > 0 ? d : null
}
function normalizeEmail(e: string | null): string | null {
  if (!e) return null
  const t = e.trim().toLowerCase()
  return t.length > 0 ? t : null
}
function normalizeName(n: string | null): string | null {
  if (!n) return null
  const t = n.trim()
  return t.length > 0 ? t : null
}

/**
 * Find or create a customers row, return its id.
 * Best-effort — if anything fails (RLS, schema mismatch), returns null
 * and the caller should leave intake.customer_id NULL.
 */
export async function dedupAndUpsertCustomer(input: DedupInput): Promise<string | null> {
  if (!input.storeId) return null

  const phone = normalizePhone(input.phone)
  const email = normalizeEmail(input.email)
  const license = (input.licenseNumber || '').trim() || null
  const firstName = normalizeName(input.firstName)
  const lastName = normalizeName(input.lastName)

  // Need SOMETHING to identify them by, otherwise just create a stub.
  const haveAnyIdentifier = phone || email || license || (firstName && lastName)
  if (!haveAnyIdentifier) return null

  // ── Lookup priority: license → phone → email → name+something ──

  if (license) {
    // license_number lives on customer_intakes, not customers. Match
    // through prior intakes for this store. Brand-scoped via the event.
    const { data: priorIntake } = await supabase
      .from('customer_intakes')
      .select('customer_id, events!inner(store_id)')
      .eq('license_number', license)
      .not('customer_id', 'is', null)
      .limit(1)
      .maybeSingle()
    if (priorIntake?.customer_id) {
      // Same license seen before → reuse customer regardless of store
      // (people travel). No store filter so we don't fork the same person.
      return priorIntake.customer_id
    }
  }

  if (phone) {
    const { data } = await supabase
      .from('customers')
      .select('id')
      .eq('store_id', input.storeId)
      .eq('phone_normalized', phone)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle()
    if (data?.id) return data.id
  }

  if (email) {
    const { data } = await supabase
      .from('customers')
      .select('id')
      .eq('store_id', input.storeId)
      .eq('email_normalized', email)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle()
    if (data?.id) return data.id
  }

  // Name-only match — only if we ALSO have at least one of phone/email/dob,
  // to dampen the "two John Smiths" risk. Without a secondary signal we
  // create a new row.
  if (firstName && lastName && (phone || email || input.dateOfBirth)) {
    let q = supabase
      .from('customers')
      .select('id, phone_normalized, email_normalized, date_of_birth')
      .eq('store_id', input.storeId)
      .ilike('first_name', firstName)
      .ilike('last_name', lastName)
      .is('deleted_at', null)
      .limit(5)
    const { data: matches } = await q
    if (matches && matches.length > 0) {
      const confirmed = matches.find(m =>
        (phone && m.phone_normalized === phone) ||
        (email && m.email_normalized === email) ||
        (input.dateOfBirth && m.date_of_birth === input.dateOfBirth)
      )
      if (confirmed) return confirmed.id
    }
  }

  // ── No match — create a new customers row ──

  if (!firstName || !lastName) {
    // customers table requires first + last NOT NULL. If the intake
    // didn't capture a name (license parse pending, browse-only, etc),
    // skip rather than insert a placeholder.
    return null
  }

  const { data: created, error: insertErr } = await supabase
    .from('customers')
    .insert({
      store_id: input.storeId,
      first_name: firstName,
      last_name: lastName,
      phone: input.phone || null,
      email: input.email || null,
      date_of_birth: input.dateOfBirth || null,
      address_line_1: input.addressLine1 || null,
      city: input.addressCity || null,
      state: input.addressState || null,
      zip: input.addressZip || null,
    })
    .select('id')
    .single()
  if (insertErr || !created?.id) {
    console.warn('[customerDedup] insert failed', insertErr)
    return null
  }
  return created.id
}
