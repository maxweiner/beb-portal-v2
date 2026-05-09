// POST /api/reconciliation/import
//
// Accepts a Wells Fargo activity CSV + brand. Parses, filters to rows
// where DESCRIPTION ∈ {CHECK, CASHED CHECK, DEPOSITED OR CASHED CHECK}
// (case-insensitive) AND CHECK # is non-empty, batch-inserts into
// cleared_checks (idempotent via the unique constraint on
// brand+check_number+cleared_date+cleared_amount), records a
// cleared_check_imports row with diagnostic counts, then re-runs the
// matcher.
//
// Auth: accounting + admin + superadmin + partners (matches the
// role gate elsewhere in the app).
//
// Body (JSON): { brand: 'beb' | 'liberty', filename: string, csv: string }
// Response: { import_id, row_count, imported_count, skipped_count,
//             duplicate_count, match_summary }

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

const ALLOWED_DESCRIPTIONS = new Set([
  'check',
  'cashed check',
  'deposited or cashed check',
])

interface ParsedRow {
  cleared_date: string       // ISO YYYY-MM-DD
  cleared_amount: number     // positive
  description: string        // raw
  status: string | null
  check_number: string
  raw: Record<string, string>
}

interface ParseResult {
  total: number              // every CSV row
  imported: ParsedRow[]      // rows that pass the filter
  skipped: number            // rows filtered out (deposits, fees, etc.)
}

// Minimal CSV parser. Wells Fargo wraps every value in quotes and uses
// commas as separators; commas inside quoted values are rare in their
// activity export but the parser handles them anyway.
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++ }
      else { inQuotes = !inQuotes }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out.map(s => s.trim())
}

function parseDateMmDdYyyy(s: string): string | null {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  const [, mm, dd, yyyy] = m
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
}

function parseAmount(s: string): number | null {
  const cleaned = s.replace(/[$,\s]/g, '')
  const n = Number.parseFloat(cleaned)
  if (!Number.isFinite(n)) return null
  return Math.abs(n)
}

function parseCsv(csv: string): ParseResult {
  const lines = csv.split(/\r?\n/).filter(l => l.length > 0)
  if (lines.length === 0) return { total: 0, imported: [], skipped: 0 }

  // Header row — find column indices defensively. WF default order is
  // DATE, DESCRIPTION, AMOUNT, CHECK #, STATUS but we don't assume.
  const header = splitCsvLine(lines[0]).map(h => h.toLowerCase())
  const idx = {
    date:        header.findIndex(h => h === 'date'),
    description: header.findIndex(h => h === 'description'),
    amount:      header.findIndex(h => h === 'amount'),
    checkNumber: header.findIndex(h => h.replace(/\s/g, '') === 'check#'),
    status:      header.findIndex(h => h === 'status'),
  }
  if (idx.date < 0 || idx.description < 0 || idx.amount < 0 || idx.checkNumber < 0) {
    throw new Error('CSV header missing required columns: DATE, DESCRIPTION, AMOUNT, CHECK #')
  }

  const imported: ParsedRow[] = []
  let skipped = 0

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i])
    if (cols.length < header.length) { skipped++; continue }
    const description = (cols[idx.description] || '').toLowerCase().trim()
    const checkNumber = (cols[idx.checkNumber] || '').trim()
    if (!checkNumber || !ALLOWED_DESCRIPTIONS.has(description)) { skipped++; continue }
    const isoDate = parseDateMmDdYyyy(cols[idx.date])
    const amount = parseAmount(cols[idx.amount])
    if (!isoDate || amount == null || amount === 0) { skipped++; continue }
    const raw: Record<string, string> = {}
    header.forEach((h, j) => { raw[h] = cols[j] ?? '' })
    imported.push({
      cleared_date: isoDate,
      cleared_amount: amount,
      description: cols[idx.description] || '',
      status: idx.status >= 0 ? (cols[idx.status] || null) : null,
      check_number: checkNumber,
      raw,
    })
  }

  return { total: lines.length - 1, imported, skipped }
}

function isAllowed(role: string | null | undefined, isPartner: boolean | null | undefined): boolean {
  return role === 'accounting' || role === 'admin' || role === 'superadmin' || isPartner === true
}

export async function POST(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAllowed(me.role as any, (me as any).is_partner)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const brand = body?.brand
  const filename = String(body?.filename || 'upload.csv')
  const csv = String(body?.csv || '')
  if (brand !== 'beb' && brand !== 'liberty') {
    return NextResponse.json({ error: 'brand must be "beb" or "liberty"' }, { status: 400 })
  }
  if (!csv) return NextResponse.json({ error: 'csv body required' }, { status: 400 })

  let parsed: ParseResult
  try { parsed = parseCsv(csv) }
  catch (e: any) { return NextResponse.json({ error: e?.message || 'Parse failed' }, { status: 400 }) }

  const sb = admin()

  // Insert the import row first; we need its id for cleared_checks.import_batch_id.
  const { data: importRow, error: importErr } = await sb
    .from('cleared_check_imports')
    .insert({
      brand,
      filename,
      uploaded_by: me.email || '(unknown)',
      row_count: parsed.total,
      imported_count: 0,   // back-fill after insert
      skipped_count: parsed.skipped,
      duplicate_count: 0,
    })
    .select('id')
    .single()
  if (importErr || !importRow) {
    return NextResponse.json({ error: importErr?.message || 'Could not create import row' }, { status: 500 })
  }
  const importId = importRow.id as string

  // Bulk insert cleared_checks. ON CONFLICT DO NOTHING via the unique
  // index makes re-imports of the same WF export safe.
  let importedCount = 0
  let duplicateCount = 0
  if (parsed.imported.length > 0) {
    const payload = parsed.imported.map(r => ({
      brand,
      check_number: r.check_number,
      cleared_date: r.cleared_date,
      cleared_amount: r.cleared_amount,
      description: r.description,
      status: r.status,
      import_batch_id: importId,
      raw_row: r.raw,
    }))
    const { data: inserted, error: insertErr } = await sb
      .from('cleared_checks')
      .upsert(payload, {
        onConflict: 'brand,check_number,cleared_date,cleared_amount',
        ignoreDuplicates: true,
      })
      .select('id')
    if (insertErr) {
      return NextResponse.json({ error: `Insert failed: ${insertErr.message}` }, { status: 500 })
    }
    importedCount = (inserted || []).length
    duplicateCount = parsed.imported.length - importedCount
  }

  await sb
    .from('cleared_check_imports')
    .update({
      imported_count: importedCount,
      duplicate_count: duplicateCount,
    })
    .eq('id', importId)

  // Re-run matcher for this brand so the UI reflects the new clearings.
  const { data: matchSummary, error: matchErr } = await sb
    .rpc('reconciliation_run_match', { p_brand: brand })
  if (matchErr) {
    return NextResponse.json({
      ok: true,
      import_id: importId,
      row_count: parsed.total,
      imported_count: importedCount,
      skipped_count: parsed.skipped,
      duplicate_count: duplicateCount,
      match_summary: null,
      match_error: matchErr.message,
    })
  }

  return NextResponse.json({
    ok: true,
    import_id: importId,
    row_count: parsed.total,
    imported_count: importedCount,
    skipped_count: parsed.skipped,
    duplicate_count: duplicateCount,
    match_summary: matchSummary,
  })
}
