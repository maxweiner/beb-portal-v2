// When the source name was something like "Smith," with no second
// token, my splitter produced first_name="Smith," + last_name="".
// Strip those stray commas. Only touches rows where last_name is
// empty/null — leaves "Smith, John" → first_name="Smith,",
// last_name="John" rows alone (real lastname-first ordering, which
// is a separate cleanup if we want it).
//
// Run:
//   set -a && . ./.env.local && set +a
//   npx tsx scripts/clean-name-commas.ts            # dry run
//   npx tsx scripts/clean-name-commas.ts --execute  # commit

import { createClient } from '@supabase/supabase-js'

const EXECUTE = process.argv.includes('--execute')

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } }
)

;(async () => {
  // Pull every imported row in pages of 1000 (default cap).
  const PAGE = 1000
  let from = 0
  type Row = { id: string; first_name: string; last_name: string | null }
  // Replace comma with space, collapse, then split into first/last on
  // the first space — turns "Winters,Mary" into first="Winters",
  // last="Mary" rather than the mashed-together "WintersMary".
  const updates: { id: string; first_name: string; last_name: string }[] = []
  while (true) {
    const { data, error } = await sb
      .from('customers')
      .select('id, first_name, last_name')
      .eq('import_source', 'simplybook')
      .like('first_name', '%,%')
      .or('last_name.is.null,last_name.eq.')
      .range(from, from + PAGE - 1)
    if (error) { console.error(error); process.exit(1) }
    if (!data || data.length === 0) break
    for (const row of data as Row[]) {
      const merged = row.first_name.replace(/,/g, ' ').replace(/\s+/g, ' ').trim()
      const sp = merged.indexOf(' ')
      const newFirst = sp >= 0 ? merged.slice(0, sp) : merged
      const newLast  = sp >= 0 ? merged.slice(sp + 1) : ''
      if (newFirst !== row.first_name || newLast !== (row.last_name ?? '')) {
        updates.push({ id: row.id, first_name: newFirst, last_name: newLast })
      }
    }
    if (data.length < PAGE) break
    from += PAGE
  }
  console.log(`To update: ${updates.length}`)
  if (updates.length) {
    console.log('Examples:')
    for (const u of updates.slice(0, 8)) console.log(`  ${u.id}  ->  first=${JSON.stringify(u.first_name)}  last=${JSON.stringify(u.last_name)}`)
  }

  if (!EXECUTE) {
    console.log('\nDRY RUN — pass --execute to commit.')
    return
  }
  if (!updates.length) { console.log('Nothing to do.'); return }

  console.log(`\nUpdating ${updates.length} rows …`)
  const CHUNK = 100
  let done = 0
  for (let i = 0; i < updates.length; i += CHUNK) {
    const slice = updates.slice(i, i + CHUNK)
    await Promise.all(slice.map(u =>
      sb.from('customers').update({ first_name: u.first_name, last_name: u.last_name }).eq('id', u.id)
    ))
    done += slice.length
    console.log(`  ${done}/${updates.length}`)
  }
  console.log('Done.')
})().catch(err => { console.error(err); process.exit(1) })
