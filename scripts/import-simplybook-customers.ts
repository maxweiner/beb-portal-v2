// One-shot: import the cleaned SimplyBook.me client list into customers.
//
// Source file (default): ~/Desktop/Customers - company_clients.csv with 5 cols
//   Name, Email, Telephone, Creation Date, Store
//
// Behavior:
//   - Looks up each row's Store against `stores.name` with case-insensitive
//     and "common-suffix-tolerant" fuzzy matching. Logs every unmatched
//     store name once at the start of the dry-run; those rows are skipped.
//   - Skips rows where Store is blank.
//   - Skips rows whose Name contains "welsch" or "max weiner"
//     (case-insensitive — staff/test data).
//   - Tags every inserted row with import_source='simplybook' and a
//     shared import_batch_id (printed at the end) so the whole batch
//     can be queried or rolled back as a unit.
//   - Defaults to dry-run. Pass --execute to actually write.
//
// Run:
//   set -a && . ./.env.local && set +a
//   npx tsx scripts/import-simplybook-customers.ts                 # dry run
//   npx tsx scripts/import-simplybook-customers.ts --execute       # live
//   npx tsx scripts/import-simplybook-customers.ts --file PATH.csv # custom

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { parseCsv } from '../lib/customers/csv'

const args = process.argv.slice(2)
const EXECUTE = args.includes('--execute')
const fileFlagIdx = args.indexOf('--file')
const FILE = fileFlagIdx >= 0
  ? args[fileFlagIdx + 1]
  : '/Users/maxweiner/Desktop/Customers - company_clients.csv'
const onlyIdx = args.indexOf('--only-source-stores')
// Comma-separated list of source-store names (exactly as they appear
// in the CSV's Store column). When set, every other row is dropped.
// Use this to back-fill clients for stores that were missing on a
// prior run.
const ONLY_SOURCE_STORES: Set<string> | null = onlyIdx >= 0
  ? new Set(args[onlyIdx + 1].split(',').map(s => s.trim()).filter(Boolean))
  : null

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_KEY
if (!url || !key) {
  console.error('Missing env: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY')
  process.exit(1)
}
const sb = createClient(url, key, { auth: { persistSession: false } })

// ─── name/email skip list (case-insensitive contains-match) ───────────
// Staff/test rows. Anyone whose Name OR Email contains any of these
// gets dropped. Email is checked too because the same staff phone has
// rows under different first names (e.g. just "jim" with email
// welsch@cox.net) that wouldn't be caught by name alone.
const TEXT_BLOCKLIST = ['welsch', 'max weiner', 'maxweiner', 'max.weiner']

// ─── explicit store overrides ──────────────────────────────────────────
// Source name (from SimplyBook) → exact name in beb-portal-v2 stores.
// Use this for legitimate matches the fuzzy ratio misses (rebrands,
// physical-location names that don't share text with the legal name).
const STORE_OVERRIDES: Record<string, string> = {
  'Goodman Jewelers - Hampton':       'Goodman & Sons, Hampton',
  'Goodman Jewelers - Williamsburg':  'Goodman & Sons, Williamsburg',
  'Disinger Jewelers':                'Disinger Jewelers of French Lick',
}

// ─── store-name normalization for fuzzy matching ───────────────────────
// Drops common biz suffixes & non-alphanumerics so "Sami Fine Jewelry"
// matches "Sami Fine Jewelers", "Picken Jewelers" matches "Pickens
// Jewelers" (after trailing-s tolerance), etc.
function normStore(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    // tolerate the "jewelery" misspelling found in the source data
    .replace(/\b(jewelers?|jewellery?|jewelery|jewelry|inc|fine|co)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Levenshtein-similarity ratio (0..1).
function ratio(a: string, b: string): number {
  if (a === b) return 1
  if (!a.length || !b.length) return 0
  const m = a.length, n = b.length
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
    }
  }
  return 1 - d[m][n] / Math.max(m, n)
}

type Store = { id: string; name: string }

function buildStoreMap(stores: Store[], sourceNames: string[]): {
  resolved: Map<string, string>           // source name → store id
  unmatched: string[]                     // source names with no good match
  diagnostics: Array<{ src: string; matched: string; score: number }>
} {
  const resolved = new Map<string, string>()
  const unmatched: string[] = []
  const diagnostics: Array<{ src: string; matched: string; score: number }> = []
  const byName = new Map(stores.map(s => [s.name, s]))
  for (const src of sourceNames) {
    // 1. Hard override wins.
    const override = STORE_OVERRIDES[src]
    if (override) {
      const target = byName.get(override)
      if (!target) {
        console.warn(`  override "${src}" -> "${override}" but that store doesn't exist in stores table`)
        unmatched.push(src); continue
      }
      resolved.set(src, target.id)
      diagnostics.push({ src, matched: target.name, score: 1 })
      continue
    }
    // 2. Fuzzy match.
    const n = normStore(src)
    let bestStore: Store | null = null
    let bestScore = 0
    for (const s of stores) {
      const score = ratio(n, normStore(s.name))
      if (score > bestScore) { bestScore = score; bestStore = s }
    }
    if (bestStore && bestScore >= 0.85) {
      resolved.set(src, bestStore.id)
      diagnostics.push({ src, matched: bestStore.name, score: bestScore })
    } else {
      unmatched.push(src)
    }
  }
  return { resolved, unmatched, diagnostics }
}

function splitName(full: string): { first: string; last: string } {
  const t = full.trim().replace(/\s+/g, ' ')
  if (!t) return { first: '', last: '' }
  const sp = t.indexOf(' ')
  if (sp < 0) return { first: t, last: '' }
  return { first: t.slice(0, sp), last: t.slice(sp + 1) }
}

function parseCreationDate(raw: string): string | null {
  // Source CSV format: "2023-06-13 23:09:01" (ISO-like, space-separated).
  // Postgres TIMESTAMPTZ accepts this directly. Treat as UTC.
  if (!raw) return null
  const s = raw.trim()
  if (!s) return null
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})$/.exec(s)
  if (m) {
    const [, y, mo, d, h, mi, se] = m
    const pad = (x: string) => x.padStart(2, '0')
    return `${y}-${pad(mo)}-${pad(d)} ${pad(h)}:${mi}:${se}+00`
  }
  // Fallback: hand it to Postgres unchanged; it parses many shapes.
  return s
}

function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, '')
}

;(async () => {
  // ── 1. Load source ────────────────────────────────────────────────────
  console.log(`\nReading ${FILE}`)
  const text = readFileSync(FILE, 'utf8')
  const rows = parseCsv(text)
  if (rows.length < 2) { console.error('Empty CSV'); process.exit(1) }
  const header = rows[0].map(h => h.trim().toLowerCase())
  const idx = (name: string) => header.indexOf(name.toLowerCase())
  const iName  = idx('name')
  const iEmail = idx('email')
  const iPhone = idx('telephone')
  const iCreated = idx('creation date')
  const iStore = idx('store')
  if ([iName, iEmail, iPhone, iCreated, iStore].some(i => i < 0)) {
    console.error('Missing expected column. Header was:', rows[0])
    process.exit(1)
  }
  const dataRows = rows.slice(1).filter(r => r.some(c => c.trim() !== ''))
  console.log(`  ${dataRows.length} data rows`)

  // ── 2. Load stores from DB ────────────────────────────────────────────
  console.log(`\nLoading stores from beb-portal-v2 …`)
  const { data: stores, error: storesErr } = await sb
    .from('stores').select('id, name').order('name')
  if (storesErr) { console.error(storesErr); process.exit(1) }
  console.log(`  ${stores!.length} stores`)

  // ── 3. Build source-store → store_id map ──────────────────────────────
  const sourceStores = Array.from(new Set(dataRows.map(r => r[iStore]?.trim()).filter(Boolean) as string[])).sort()
  const { resolved: storeMap, unmatched, diagnostics } = buildStoreMap(stores!, sourceStores)
  console.log(`\nStore name resolution:`)
  for (const d of diagnostics.sort((a, b) => a.src.localeCompare(b.src))) {
    const flag = d.src === d.matched ? '   ' : ' ~ '
    console.log(`  ${flag}${d.src.padEnd(35)} -> ${d.matched.padEnd(35)} (${d.score.toFixed(2)})`)
  }
  if (unmatched.length) {
    console.log(`\n  UNMATCHED stores (${unmatched.length}) — clients in these are skipped:`)
    for (const u of unmatched) console.log(`    ${u}`)
  }

  // ── 4. Build insert payload + skip stats ──────────────────────────────
  const batchId = randomUUID()
  type CustomerInsert = {
    store_id: string
    first_name: string
    last_name: string
    email: string | null
    phone: string | null
    created_at: string | null
    import_source: string
    import_batch_id: string
  }
  const inserts: CustomerInsert[] = []
  let skipNoStore = 0, skipUnmatchedStore = 0, skipNameBlock = 0, skipNotInFilter = 0

  for (const r of dataRows) {
    const rawName = (r[iName] || '').trim()
    const rawStore = (r[iStore] || '').trim()
    if (!rawStore) { skipNoStore++; continue }
    if (ONLY_SOURCE_STORES && !ONLY_SOURCE_STORES.has(rawStore)) { skipNotInFilter++; continue }
    const lower = rawName.toLowerCase()
    const lowerEmail = (r[iEmail] || '').toLowerCase()
    if (TEXT_BLOCKLIST.some(b => lower.includes(b) || lowerEmail.includes(b))) { skipNameBlock++; continue }
    const storeId = storeMap.get(rawStore)
    if (!storeId) { skipUnmatchedStore++; continue }
    const { first, last } = splitName(rawName)
    const email = (r[iEmail] || '').trim().toLowerCase() || null
    const phone = ((): string | null => {
      const d = digitsOnly(r[iPhone] || '')
      if (!d) return null
      // Strip leading country code 1 if present so phone_normalized is consistent
      return d.length === 11 && d.startsWith('1') ? d.slice(1) : d
    })()
    inserts.push({
      store_id: storeId,
      first_name: first || '(unknown)',
      last_name: last || '',
      email,
      phone,
      created_at: parseCreationDate(r[iCreated] || ''),
      import_source: 'simplybook',
      import_batch_id: batchId,
    })
  }

  console.log(`\n── Dry-run summary ────────────────────────`)
  console.log(`  Source rows:                  ${dataRows.length}`)
  console.log(`  Skipped (no store):           ${skipNoStore}`)
  if (ONLY_SOURCE_STORES) {
    console.log(`  Skipped (not in --only-source-stores filter): ${skipNotInFilter}`)
  }
  console.log(`  Skipped (store not in beb):   ${skipUnmatchedStore}`)
  console.log(`  Skipped (name blocklist):     ${skipNameBlock}`)
  console.log(`  → To insert:                  ${inserts.length}`)
  console.log(`  Batch id (for rollback):      ${batchId}`)

  // ── 5. Executing? ─────────────────────────────────────────────────────
  if (!EXECUTE) {
    console.log(`\nDRY RUN — no rows written. Re-run with --execute to commit.`)
    console.log(`Sample insert payload:`)
    console.log(JSON.stringify(inserts[0], null, 2))
    return
  }

  const CHUNK = 250
  const MAX_RETRIES = 4
  console.log(`\nInserting ${inserts.length} rows in batches of ${CHUNK} (with retry) …`)

  const insertWithRetry = async (slice: typeof inserts, startIndex: number): Promise<void> => {
    let attempt = 0
    while (true) {
      attempt++
      try {
        const { error } = await sb.from('customers').insert(slice)
        if (!error) return
        // Most non-transient errors (constraint, RLS, schema) shouldn't be retried
        const msg = (error.message || '').toLowerCase()
        const transient = msg.includes('fetch') || msg.includes('timeout') || msg.includes('network') || msg.includes('econn')
        if (!transient || attempt > MAX_RETRIES) {
          throw new Error(`batch starting ${startIndex} after ${attempt} attempt(s): ${error.message}`)
        }
      } catch (e: any) {
        const msg = (e?.message || '').toLowerCase()
        const transient = msg.includes('fetch') || msg.includes('timeout') || msg.includes('network') || msg.includes('econn')
        if (!transient || attempt > MAX_RETRIES) throw e
      }
      const backoffMs = Math.min(1000 * 2 ** (attempt - 1), 8000)
      console.log(`    transient error on batch ${startIndex}, retrying in ${backoffMs}ms (attempt ${attempt}/${MAX_RETRIES}) …`)
      await new Promise(r => setTimeout(r, backoffMs))
    }
  }

  let inserted = 0
  try {
    for (let i = 0; i < inserts.length; i += CHUNK) {
      const slice = inserts.slice(i, i + CHUNK)
      await insertWithRetry(slice, i)
      inserted += slice.length
      console.log(`  ${inserted}/${inserts.length}`)
    }
  } catch (err: any) {
    console.error(`  ${err?.message || err}`)
    console.error(`  rolling back batch ${batchId} …`)
    const { error: delErr } = await sb.from('customers').delete().eq('import_batch_id', batchId)
    if (delErr) console.error(`  ROLLBACK ALSO FAILED: ${delErr.message} — manual cleanup required for batch ${batchId}`)
    else console.error(`  rolled back. No rows from this run remain.`)
    process.exit(1)
  }
  console.log(`\nDone. Batch ${batchId} inserted ${inserted} rows.`)
  console.log(`To roll back later:`)
  console.log(`  DELETE FROM customers WHERE import_batch_id = '${batchId}';`)
})().catch(err => { console.error(err); process.exit(1) })
