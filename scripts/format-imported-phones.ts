// Reformat imported phone values to (XXX) XXX-XXXX so the customer
// edit form (which renders raw `phone`) matches the list view
// (which goes through fmtPhone). Only touches rows from the
// SimplyBook import — leaves pre-existing customers alone.
//
// phone_normalized is a GENERATED column from `regexp_replace(phone, '\D', '')`
// so dedup queries are unaffected.
//
// Run:
//   set -a && . ./.env.local && set +a
//   npx tsx scripts/format-imported-phones.ts            # dry run
//   npx tsx scripts/format-imported-phones.ts --execute  # commit

import { createClient } from '@supabase/supabase-js'

const EXECUTE = process.argv.includes('--execute')

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } }
)

function format(raw: string | null): string | null {
  if (!raw) return null
  const d = raw.replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 11 && d.startsWith('1')) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  return raw
}

;(async () => {
  // Pull every imported row in pages of 1000 (the default cap).
  const PAGE = 1000
  let from = 0
  const updates: { id: string; phone: string }[] = []
  let unchanged = 0
  let skipped = 0
  while (true) {
    const { data, error } = await sb
      .from('customers')
      .select('id, phone')
      .eq('import_source', 'simplybook')
      .not('phone', 'is', null)
      .range(from, from + PAGE - 1)
    if (error) { console.error(error); process.exit(1) }
    if (!data || data.length === 0) break
    for (const row of data) {
      const next = format(row.phone)
      if (!next) { skipped++; continue }
      if (next === row.phone) { unchanged++; continue }
      updates.push({ id: row.id, phone: next })
    }
    if (data.length < PAGE) break
    from += PAGE
  }
  console.log(`To update:  ${updates.length}`)
  console.log(`Unchanged:  ${unchanged}`)
  console.log(`Skipped:    ${skipped}`)
  if (updates.length) {
    console.log('Examples:')
    for (const u of updates.slice(0, 3)) console.log(`  ${u.id}  ->  ${u.phone}`)
  }

  if (!EXECUTE) {
    console.log('\nDRY RUN — pass --execute to commit.')
    return
  }

  console.log(`\nUpdating ${updates.length} rows in batches of 100 …`)
  const CHUNK = 100
  let done = 0
  for (let i = 0; i < updates.length; i += CHUNK) {
    const slice = updates.slice(i, i + CHUNK)
    // Run as a single batched upsert keyed on id (won't change other columns).
    await Promise.all(slice.map(u =>
      sb.from('customers').update({ phone: u.phone }).eq('id', u.id)
    ))
    done += slice.length
    if (done % 1000 === 0 || done === updates.length) console.log(`  ${done}/${updates.length}`)
  }
  console.log('Done.')
})().catch(err => { console.error(err); process.exit(1) })
