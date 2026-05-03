// Sanity-check the SimplyBook import: row count, per-store breakdown,
// and a few duplicate-collision spot checks.
import { createClient } from '@supabase/supabase-js'

const BATCH = process.argv[2]
if (!BATCH) { console.error('Usage: ... <import_batch_id>'); process.exit(1) }

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } }
)

;(async () => {
  const { count, error } = await sb
    .from('customers')
    .select('*', { count: 'exact', head: true })
    .eq('import_batch_id', BATCH)
  if (error) { console.error(error); process.exit(1) }
  console.log(`Total rows in batch ${BATCH}: ${count}`)

  // Per-store breakdown — paginate (default Supabase limit is 1000)
  const counts = new Map<string, number>()
  const PAGE = 1000
  let from = 0
  while (true) {
    const { data: rows, error: e2 } = await sb
      .from('customers')
      .select('store_id, stores!inner(name)')
      .eq('import_batch_id', BATCH)
      .range(from, from + PAGE - 1)
    if (e2) { console.error(e2); process.exit(1) }
    if (!rows || rows.length === 0) break
    for (const r of rows) {
      const name = (r as any).stores.name as string
      counts.set(name, (counts.get(name) || 0) + 1)
    }
    if (rows.length < PAGE) break
    from += PAGE
  }
  console.log(`\nPer-store row counts (n=${counts.size} stores):`)
  for (const [name, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(5)}  ${name}`)
  }

  // Spot check: any rows with NULL email AND NULL phone? (shouldn't be)
  const { count: badContact } = await sb
    .from('customers')
    .select('*', { count: 'exact', head: true })
    .eq('import_batch_id', BATCH)
    .is('email', null).is('phone', null)
  console.log(`\nRows with neither email nor phone: ${badContact ?? 0} (should be 0)`)
})()
