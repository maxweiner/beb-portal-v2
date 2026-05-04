#!/usr/bin/env node
// One-shot importer: read ~/Desktop/Shows for import.xlsx and
// repopulate trunk_shows from the legacy spreadsheet.
//
// For each row:
//   1. Look up trunk_show_stores by case-insensitive name. If none,
//      create a placeholder row with just the name.
//   2. Inherit the matched store's trunk_rep_user_id as the
//      trunk show's assigned_rep_id (NULL if not set).
//   3. Insert into trunk_shows with vip_showing + the six milestone
//      date columns from the spreadsheet.
//
// Run with:
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \
//     node scripts/import-trunk-shows-from-spreadsheet.mjs
// (the env vars come from .env.local — load it manually if needed).

import ExcelJS from 'exceljs'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

// Auto-load .env.local so you can just run:
//   node scripts/import-trunk-shows-from-spreadsheet.mjs
const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '..', '.env.local')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
}

const FILE = '/Users/maxweiner/Desktop/Shows for import.xlsx'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY env vars.')
  process.exit(1)
}
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

function isoDate(v) {
  if (!v) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10)
  return null
}

async function main() {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(FILE)
  const ws = wb.worksheets[0]
  console.log(`[import] reading ${FILE} — ${ws.rowCount} rows`)

  // Pre-load existing trunk_show_stores keyed by lowercased name.
  const { data: existingStores, error: storesErr } = await sb
    .from('trunk_show_stores').select('id, name, trunk_rep_user_id')
  if (storesErr) throw new Error(storesErr.message)
  const byName = new Map((existingStores || []).map(s => [String(s.name || '').trim().toLowerCase(), s]))
  console.log(`[import] ${byName.size} trunk_show_stores already in DB`)

  let inserted = 0, skipped = 0, autoCreated = 0
  const errors = []

  // Skip header row.
  for (let r = 2; r <= ws.rowCount; r++) {
    const get = (col) => ws.getRow(r).getCell(col).value
    const location = String(get(1) || '').trim()
    if (!location) { skipped++; continue }

    const vipShowing = !!get(2)
    const startDate = isoDate(get(3))
    const endDate   = isoDate(get(4)) || startDate
    if (!startDate) {
      errors.push({ row: r, reason: `missing start date for ${location}` })
      skipped++
      continue
    }

    // Paired (checkbox + date) columns — collapse to single date.
    const confirmationLetter = isoDate(get(6))
    const postcardsEmail     = isoDate(get(8))
    const postcardsOrdered   = isoDate(get(10))
    const proofed            = isoDate(get(12))
    const finalFiles         = isoDate(get(14))
    const postEventQuest     = isoDate(get(16))
    const additionalNotes    = get(17)
    const notes = additionalNotes ? String(additionalNotes).trim() || null : null

    // Get-or-create trunk_show_store.
    const key = location.toLowerCase()
    let store = byName.get(key)
    if (!store) {
      const { data: created, error } = await sb.from('trunk_show_stores')
        .insert({ name: location }).select('id, name, trunk_rep_user_id').single()
      if (error) {
        errors.push({ row: r, reason: `auto-create store ${location}: ${error.message}` })
        skipped++
        continue
      }
      store = created
      byName.set(key, store)
      autoCreated++
    }

    // Insert trunk_shows row.
    const { error: insErr } = await sb.from('trunk_shows').insert({
      store_id: store.id,
      start_date: startDate,
      end_date: endDate,
      assigned_rep_id: store.trunk_rep_user_id || null,
      status: 'scheduled',
      notes,
      vip_showing: vipShowing,
      confirmation_letter_sent_at: confirmationLetter,
      postcards_email_sent_at: postcardsEmail,
      postcards_ordered_at: postcardsOrdered,
      proofed_at: proofed,
      final_files_sent_at: finalFiles,
      post_event_questionnaire_sent_at: postEventQuest,
    })
    if (insErr) {
      errors.push({ row: r, reason: `insert trunk_show ${location} ${startDate}: ${insErr.message}` })
      skipped++
      continue
    }
    inserted++
    if (inserted % 50 === 0) console.log(`[import] inserted ${inserted}…`)
  }

  console.log(`\n[import] done`)
  console.log(`  inserted:        ${inserted}`)
  console.log(`  auto-created:    ${autoCreated} new trunk_show_stores`)
  console.log(`  skipped:         ${skipped}`)
  if (errors.length > 0) {
    console.log(`  errors (first 20):`)
    for (const e of errors.slice(0, 20)) console.log(`    row ${e.row}: ${e.reason}`)
    if (errors.length > 20) console.log(`    … and ${errors.length - 20} more`)
  }
}

main().catch(err => {
  console.error('[import] fatal:', err)
  process.exit(1)
})
