// POST /api/marketing/store-postcard-lists/upload
//
// Multipart form fields: { file: File, store_id: string, campaign_id: string }
//
// Parses CSV (First Name, Last Name, Address Line 1, Address Line 2,
// City, State, Zip), de-dupes against existing rows for the same store
// using (address_line_1, zip), inserts new rows + audit row in
// postcard_uploads. Returns counts so the client can display the spec
// summary "Uploaded 1,432 rows: 1,287 new, 145 duplicates."
//
// Auth: marketing_access required.
//
// CSV parsing intentionally simple — splits on commas, strips wrapping
// quotes. If users hit issues with quoted commas inside fields, swap
// in papaparse later.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'

export const dynamic = 'force-dynamic'
// CSV uploads can be a few MB; bump the body limit for this route.
export const maxDuration = 60

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

interface ParsedRow {
  first_name: string | null
  last_name: string | null
  address_line_1: string
  address_line_2: string | null
  city: string | null
  state: string | null
  zip: string
}

const COL_MAP: Record<string, keyof ParsedRow> = {
  // Spec headers + common variations
  'first name': 'first_name',
  'firstname': 'first_name',
  'first': 'first_name',
  'last name': 'last_name',
  'lastname': 'last_name',
  'last': 'last_name',
  'address line 1': 'address_line_1',
  'address1': 'address_line_1',
  'address': 'address_line_1',
  'street': 'address_line_1',
  'address line 2': 'address_line_2',
  'address2': 'address_line_2',
  'apt': 'address_line_2',
  'unit': 'address_line_2',
  'city': 'city',
  'state': 'state',
  'st': 'state',
  'zip': 'zip',
  'zip code': 'zip',
  'zipcode': 'zip',
  'postal code': 'zip',
  'postal': 'zip',
}

function splitCsvLine(line: string): string[] {
  // Tiny CSV split: respects double-quote-wrapped commas. Doesn't
  // handle escaped quotes inside fields ("foo""bar") — fine for the
  // postcard list shape which is plain names + addresses.
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') { inQuotes = !inQuotes; continue }
    if (c === ',' && !inQuotes) { out.push(cur); cur = ''; continue }
    cur += c
  }
  out.push(cur)
  return out.map(s => s.trim())
}

function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0)
  if (lines.length === 0) return { headers: [], rows: [] }
  const headers = splitCsvLine(lines[0]).map(h => h.toLowerCase())
  const rows = lines.slice(1).map(splitCsvLine)
  return { headers, rows }
}

function normalizeRow(headers: string[], cols: string[]): ParsedRow | null {
  const obj: Partial<ParsedRow> = {}
  for (let i = 0; i < headers.length; i++) {
    const target = COL_MAP[headers[i]]
    if (!target) continue
    const v = (cols[i] ?? '').trim()
    if (v) (obj as any)[target] = v
  }
  // Required: address_line_1 + zip
  const addr = obj.address_line_1
  let zip = (obj.zip || '').replace(/[^0-9-]/g, '')
  if (zip.includes('-')) zip = zip.split('-')[0]
  if (!addr || !/^\d{5}$/.test(zip)) return null
  return {
    first_name: obj.first_name ?? null,
    last_name: obj.last_name ?? null,
    address_line_1: addr,
    address_line_2: obj.address_line_2 ?? null,
    city: obj.city ?? null,
    state: obj.state ?? null,
    zip,
  }
}

export async function POST(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = admin()
  const { data: meRow } = await sb.from('users').select('marketing_access').eq('id', me.id).maybeSingle()
  if (!(meRow as any)?.marketing_access) {
    return NextResponse.json({ error: 'Marketing access required' }, { status: 403 })
  }

  let form: FormData
  try { form = await req.formData() }
  catch { return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 }) }

  const file = form.get('file')
  const storeId = (form.get('store_id') || '').toString()
  const campaignId = (form.get('campaign_id') || '').toString()
  if (!(file instanceof File)) return NextResponse.json({ error: 'Missing file' }, { status: 400 })
  if (!storeId) return NextResponse.json({ error: 'Missing store_id' }, { status: 400 })
  if (!campaignId) return NextResponse.json({ error: 'Missing campaign_id' }, { status: 400 })

  const text = await file.text()
  const { headers, rows: rawRows } = parseCsv(text)
  if (rawRows.length === 0) {
    return NextResponse.json({ error: 'CSV is empty.' }, { status: 400 })
  }
  if (!headers.some(h => COL_MAP[h])) {
    return NextResponse.json({
      error: 'No recognized columns. Expected: First Name, Last Name, Address Line 1, Address Line 2, City, State, Zip.',
    }, { status: 400 })
  }

  // Normalize + filter invalid rows.
  const parsed: ParsedRow[] = []
  let invalid = 0
  for (const cols of rawRows) {
    const r = normalizeRow(headers, cols)
    if (r) parsed.push(r)
    else invalid++
  }

  // Dedup against existing rows for this store on (address_line_1, zip).
  // Pull every existing key for the store — fine up to ~50k rows; if
  // bigger, switch to per-row exists() queries.
  const { data: existing } = await sb
    .from('store_postcard_lists')
    .select('id, address_line_1, zip')
    .eq('store_id', storeId)
  const existingKey = new Set(
    ((existing ?? []) as { id: string; address_line_1: string; zip: string }[])
      .map(r => `${r.address_line_1.toLowerCase().trim()}|${r.zip}`)
  )
  // Map to find the canonical id when an upload row is a duplicate.
  const existingIdByKey = new Map<string, string>()
  for (const r of (existing ?? []) as { id: string; address_line_1: string; zip: string }[]) {
    existingIdByKey.set(`${r.address_line_1.toLowerCase().trim()}|${r.zip}`, r.id)
  }

  // Also dedup within the upload itself.
  const seen = new Set<string>()
  const newRows: ParsedRow[] = []
  const dupeRows: { row: ParsedRow; canonical_id: string }[] = []
  for (const r of parsed) {
    const k = `${r.address_line_1.toLowerCase().trim()}|${r.zip}`
    if (seen.has(k)) {
      dupeRows.push({ row: r, canonical_id: existingIdByKey.get(k) || '' })
      continue
    }
    seen.add(k)
    if (existingKey.has(k)) {
      dupeRows.push({ row: r, canonical_id: existingIdByKey.get(k) || '' })
    } else {
      newRows.push(r)
    }
  }

  // Insert audit row first so we have an id to use for created_via.
  const { data: uploadRow, error: upErr } = await sb.from('postcard_uploads').insert({
    campaign_id: campaignId,
    store_id: storeId,
    uploaded_by: me.id,
    original_filename: file.name,
    total_rows: parsed.length,
    new_rows: newRows.length,
    duplicate_rows: dupeRows.length,
    file_url: null,  // Could store the CSV in Storage later; skipped for v1
  }).select('id').single()
  if (upErr || !uploadRow) {
    return NextResponse.json({ error: upErr?.message || 'Could not log upload' }, { status: 500 })
  }

  // Bulk insert the new rows. Chunk to keep payload manageable.
  if (newRows.length > 0) {
    const CHUNK = 500
    for (let i = 0; i < newRows.length; i += CHUNK) {
      const chunk = newRows.slice(i, i + CHUNK).map(r => ({
        store_id: storeId,
        first_name: r.first_name,
        last_name: r.last_name,
        address_line_1: r.address_line_1,
        address_line_2: r.address_line_2,
        city: r.city,
        state: r.state,
        zip: r.zip,
        created_via: `upload:${uploadRow.id}`,
      }))
      const { error: insErr } = await sb.from('store_postcard_lists').insert(chunk)
      if (insErr) {
        // Don't fail the whole request — the audit row already records
        // intent. Surface so the user sees the partial result.
        return NextResponse.json({
          ok: true, partial: true,
          upload_id: uploadRow.id,
          total: parsed.length,
          new: i,
          duplicate: dupeRows.length,
          invalid,
          error: insErr.message,
        })
      }
    }
  }

  return NextResponse.json({
    ok: true,
    upload_id: uploadRow.id,
    total: parsed.length,
    new: newRows.length,
    duplicate: dupeRows.length,
    invalid,
  })
}
