// POST /api/customers/import
//
// Body: multipart form with `file` (the CSV) + `storeId` + `mode`
// where mode = 'preview' | 'commit'.
//
// Preview mode: parse + validate + dry-run dedup. Returns counts +
// errors[]. No writes.
//
// Commit mode: same parse + validate, but also writes:
//  - Auto-merges (exact email/phone match) → updates existing
//    customer with newly-supplied non-null fields (never overwrites
//    a value with NULL)
//  - Possible matches → inserts a customer_dedup_review_queue row
//    with incoming_data JSONB + match_confidence + match_reasons
//  - No-match rows → inserts a fresh customers row
//  - Records the run in customer_imports
//
// Admin-only via getAuthedUser + isAdminLike.
//
// Phone/email normalization handled by lib/customers/csv.ts; dedup
// matching by lib/customers/dedup.ts.

import { NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getAuthedUser, isAdminLike } from '@/lib/expenses/serverAuth'
import { blockIfImpersonating } from '@/lib/impersonation/server'
import {
  parseCsv, normalizeHeader, normalizePhone, normalizeEmail,
  normalizeDate, parseYesNo,
} from '@/lib/customers/csv'
import { matchDedup, type DedupCandidate, type DedupExisting } from '@/lib/customers/dedup'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

interface ParsedRow {
  rowNumber: number  // 1-based, matches the user's CSV viewer
  first_name: string
  last_name: string
  address_line_1: string | null
  address_line_2: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
  email: string | null
  date_of_birth: string | null
  how_did_you_hear_legacy: string | null
  notes: string | null
  last_contact_date: string | null
  do_not_contact: boolean
  // Computed from raw phone/email for dedup
  phone_normalized: string | null
  email_normalized: string | null
}

interface RowError { row: number; reason: string }

const REQUIRED_HEADERS = ['first_name', 'last_name']

const HEADER_ALIASES: Record<string, string> = {
  // canonical → accepted variants (header is normalized first via normalizeHeader)
  first_name: 'first_name', firstname: 'first_name', first: 'first_name', fname: 'first_name',
  last_name: 'last_name',  lastname: 'last_name',  last: 'last_name',  lname: 'last_name',
  address_line_1: 'address_line_1', address1: 'address_line_1', addressline1: 'address_line_1', address: 'address_line_1',
  address_line_2: 'address_line_2', address2: 'address_line_2', addressline2: 'address_line_2', apt: 'address_line_2', unit: 'address_line_2',
  city: 'city',
  state: 'state', st: 'state',
  zip: 'zip', zipcode: 'zip', postal: 'zip', postalcode: 'zip',
  phone: 'phone', phonenumber: 'phone', tel: 'phone', cell: 'phone', mobile: 'phone',
  email: 'email', emailaddress: 'email',
  date_of_birth: 'date_of_birth', dob: 'date_of_birth', birthdate: 'date_of_birth', birthday: 'date_of_birth',
  how_did_you_hear: 'how_did_you_hear_legacy', source: 'how_did_you_hear_legacy', referral_source: 'how_did_you_hear_legacy', howheard: 'how_did_you_hear_legacy',
  notes: 'notes', note: 'notes', comments: 'notes',
  last_contact_date: 'last_contact_date', lastcontact: 'last_contact_date',
  do_not_contact: 'do_not_contact', dnc: 'do_not_contact', donotcontact: 'do_not_contact', donotmail: 'do_not_contact',
}

export async function POST(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdminLike(me)) return NextResponse.json({ error: 'Admin required' }, { status: 403 })

  let form: FormData
  try { form = await req.formData() }
  catch { return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 }) }

  const file = form.get('file')
  const storeId = (form.get('storeId') || '').toString()
  const mode = ((form.get('mode') || 'preview').toString()) as 'preview' | 'commit'
  if (!storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 })
  if (!(file instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 })
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: 'CSV too large (max 10MB)' }, { status: 400 })

  const text = await file.text()
  const rows = parseCsv(text)
  if (rows.length < 2) return NextResponse.json({ error: 'CSV is empty or has no data rows' }, { status: 400 })

  // Header → field name map
  const headerRow = rows[0].map(h => normalizeHeader(h))
  const headerMap: Record<string, number> = {}
  for (let i = 0; i < headerRow.length; i++) {
    const canonical = HEADER_ALIASES[headerRow[i]]
    if (canonical) headerMap[canonical] = i
  }
  for (const required of REQUIRED_HEADERS) {
    if (headerMap[required] === undefined) {
      return NextResponse.json({
        error: `Missing required column: ${required}. Headers seen: ${rows[0].join(', ')}`,
      }, { status: 400 })
    }
  }

  // Parse + validate every row
  const parsed: ParsedRow[] = []
  const errors: RowError[] = []
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    const get = (k: string) => {
      const idx = headerMap[k]; if (idx === undefined) return null
      const v = (r[idx] ?? '').toString().trim()
      return v.length > 0 ? v : null
    }
    const first_name = get('first_name')
    const last_name = get('last_name')
    if (!first_name || !last_name) {
      errors.push({ row: i + 1, reason: 'Missing first_name or last_name' })
      continue
    }
    const phoneRaw = get('phone')
    const emailRaw = get('email')
    const dobRaw = get('date_of_birth')
    const lastContactRaw = get('last_contact_date')

    const phone_normalized = normalizePhone(phoneRaw)
    if (phoneRaw && !phone_normalized) {
      errors.push({ row: i + 1, reason: `Invalid phone: ${phoneRaw}` }); continue
    }
    const email_normalized = normalizeEmail(emailRaw)
    if (emailRaw && !email_normalized) {
      errors.push({ row: i + 1, reason: `Invalid email: ${emailRaw}` }); continue
    }
    const dob = dobRaw ? normalizeDate(dobRaw) : null
    if (dobRaw && !dob) {
      errors.push({ row: i + 1, reason: `Invalid date of birth: ${dobRaw}` }); continue
    }
    const lastContact = lastContactRaw ? normalizeDate(lastContactRaw) : null
    if (lastContactRaw && !lastContact) {
      errors.push({ row: i + 1, reason: `Invalid last_contact_date: ${lastContactRaw}` }); continue
    }

    parsed.push({
      rowNumber: i + 1,
      first_name, last_name,
      address_line_1: get('address_line_1'),
      address_line_2: get('address_line_2'),
      city: get('city'),
      state: get('state')?.toUpperCase() || null,
      zip: get('zip'),
      phone: phoneRaw,
      email: emailRaw,
      date_of_birth: dob,
      how_did_you_hear_legacy: get('how_did_you_hear_legacy'),
      notes: get('notes'),
      last_contact_date: lastContact,
      do_not_contact: parseYesNo(get('do_not_contact')),
      phone_normalized, email_normalized,
    })
  }

  // Pull all existing customers in this store for dedup matching.
  const sb = admin()
  const { data: existingRaw, error: exErr } = await sb.from('customers')
    .select('id, first_name, last_name, address_line_1, city, zip, phone_normalized, email_normalized')
    .eq('store_id', storeId)
    .is('deleted_at', null)
  if (exErr) return NextResponse.json({ error: `Load existing failed: ${exErr.message}` }, { status: 500 })
  const existing: DedupExisting[] = (existingRaw ?? []) as DedupExisting[]

  // Run dedup verdict for every parsed row
  let newCount = 0, mergedCount = 0, flaggedCount = 0
  type RowAction = { row: ParsedRow; verdict: ReturnType<typeof matchDedup> }
  const actions: RowAction[] = parsed.map(row => {
    const candidate: DedupCandidate = {
      first_name: row.first_name, last_name: row.last_name,
      address_line_1: row.address_line_1, city: row.city, zip: row.zip,
      phone_normalized: row.phone_normalized, email_normalized: row.email_normalized,
    }
    const verdict = matchDedup(candidate, existing)
    if (verdict.kind === 'auto_merge') mergedCount++
    else if (verdict.kind === 'review') flaggedCount++
    else newCount++
    return { row, verdict }
  })

  if (mode === 'preview') {
    return NextResponse.json({
      ok: true, mode,
      total: parsed.length + errors.length,
      previewable: parsed.length,
      newCount, mergedCount, flaggedCount,
      errors,
    })
  }

  // Block destructive actions while max@bebllp.com is in view-as mode.
  // Preview mode above is read-only and intentionally allowed.
  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  // ── Commit mode ────────────────────────────────────────────
  // Insert/update one row at a time. Slow for huge imports but
  // simpler + safer than batching with CTEs. Tracks per-row outcome
  // and emits a customer_events row per affected customer.
  for (const a of actions) {
    if (a.verdict.kind === 'auto_merge') {
      // Merge: only overwrite a target column when the incoming is NOT NULL.
      const updates: Record<string, unknown> = {
        address_line_1: a.row.address_line_1 ?? undefined,
        address_line_2: a.row.address_line_2 ?? undefined,
        city: a.row.city ?? undefined,
        state: a.row.state ?? undefined,
        zip: a.row.zip ?? undefined,
        phone: a.row.phone ?? undefined,
        email: a.row.email ?? undefined,
        date_of_birth: a.row.date_of_birth ?? undefined,
        how_did_you_hear_legacy: a.row.how_did_you_hear_legacy ?? undefined,
        notes: a.row.notes ?? undefined,
        last_contact_date: a.row.last_contact_date ?? undefined,
        do_not_contact: a.row.do_not_contact || undefined,
      }
      const cleaned: Record<string, unknown> = {}
      for (const k of Object.keys(updates)) if (updates[k] !== undefined) cleaned[k] = updates[k]
      if (Object.keys(cleaned).length > 0) {
        await sb.from('customers').update(cleaned).eq('id', a.verdict.existing.id)
        await sb.from('customer_events').insert({
          customer_id: a.verdict.existing.id, event_type: 'merged', actor_id: me.id,
          description: `Merged from CSV import: ${a.verdict.reasons.join(', ')}`,
        })
      }
    } else if (a.verdict.kind === 'review') {
      await sb.from('customer_dedup_review_queue').insert({
        existing_customer_id: a.verdict.existing.id,
        incoming_data: a.row,
        match_confidence: a.verdict.confidence,
        match_reasons: a.verdict.reasons,
        source: 'import',
      })
    } else {
      const { data: created } = await sb.from('customers').insert({
        store_id: storeId,
        first_name: a.row.first_name,
        last_name: a.row.last_name,
        address_line_1: a.row.address_line_1,
        address_line_2: a.row.address_line_2,
        city: a.row.city,
        state: a.row.state,
        zip: a.row.zip,
        phone: a.row.phone,
        email: a.row.email,
        date_of_birth: a.row.date_of_birth,
        how_did_you_hear_legacy: a.row.how_did_you_hear_legacy,
        notes: a.row.notes,
        last_contact_date: a.row.last_contact_date,
        do_not_contact: a.row.do_not_contact,
      }).select('id').single()
      if (created?.id) {
        await sb.from('customer_events').insert({
          customer_id: created.id, event_type: 'imported', actor_id: me.id,
          description: 'Created via CSV import',
        })
      }
    }
  }

  // Audit row
  await sb.from('customer_imports').insert({
    store_id: storeId,
    imported_by: me.id,
    original_filename: (file.name || 'import.csv').slice(0, 200),
    total_rows: parsed.length + errors.length,
    new_rows: newCount,
    duplicate_rows_merged: mergedCount,
    duplicate_rows_flagged: flaggedCount,
    errored_rows: errors.length,
  })

  return NextResponse.json({
    ok: true, mode,
    total: parsed.length + errors.length,
    newCount, mergedCount, flaggedCount,
    erroredCount: errors.length,
    errors,
  })
}
