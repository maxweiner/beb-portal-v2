// Tiny RFC-4180-ish CSV parser tuned for the customer import path.
// No npm dependency on purpose — keeps the bundle slim and avoids
// versioning issues. Handles:
//   - Smart-quote / curly-quote substitution
//   - BOM stripping
//   - CRLF, CR, LF line endings
//   - Quoted fields with commas inside
//   - Escaped quotes (doubled "")
//   - Trailing whitespace per field
//
// Returns string[][]. Caller maps headers → indexed columns.

export function parseCsv(input: string): string[][] {
  // Normalize encoding quirks before tokenizing.
  let text = input
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2 }
        else { inQuotes = false; i++ }
      } else {
        field += c; i++
      }
    } else {
      if (c === '"' && field.length === 0) { inQuotes = true; i++ }
      else if (c === ',') { row.push(field); field = ''; i++ }
      else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; i++ }
      else { field += c; i++ }
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  // Drop fully-empty trailing rows ("" only).
  while (rows.length > 0 && rows[rows.length - 1].every(f => f.trim() === '')) rows.pop()
  return rows
}

/** Normalize a header label so case + punctuation differences don't matter. */
export function normalizeHeader(h: string): string {
  return h.toLowerCase().trim().replace(/[\s_-]+/g, '_').replace(/[^a-z0-9_]/g, '')
}

/** US 10-digit phone normalization. Returns digits-only (10 chars) or null. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const d = raw.replace(/\D/g, '')
  if (d.length === 10) return d
  if (d.length === 11 && d.startsWith('1')) return d.slice(1)
  return null
}

/** Email normalization: lower, trim, basic format check. Returns null if invalid. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null
  const e = raw.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null
  return e
}

/** Parse YYYY-MM-DD, MM/DD/YYYY, M/D/YY, YYYY/MM/DD. Returns YYYY-MM-DD or null. */
export function normalizeDate(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = raw.trim()
  if (!s) return null
  // ISO already
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  // MM/DD/YYYY or M/D/YYYY
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s)
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  // M/D/YY → assume 19XX if ≥30, 20XX if <30 (heuristic; tweak later)
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/.exec(s)
  if (m) {
    const yy = parseInt(m[3], 10)
    const yyyy = yy < 30 ? 2000 + yy : 1900 + yy
    return `${yyyy}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  }
  // YYYY/MM/DD
  m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(s)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  return null
}

/** Y/N parser — accepts y, yes, true, 1, t (case-insensitive). Else false. */
export function parseYesNo(raw: string | null | undefined): boolean {
  if (!raw) return false
  const v = raw.trim().toLowerCase()
  return v === 'y' || v === 'yes' || v === 'true' || v === '1' || v === 't'
}
