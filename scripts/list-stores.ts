// One-shot: list all stores so we can map SimplyBook location names -> store_id.
// Usage: npx tsx scripts/list-stores.ts

import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } }
)

;(async () => {
  const { data, error } = await sb.from('stores').select('id, name').order('name')
  if (error) {
    console.error(error)
    process.exit(1)
  }
  console.log(`STORES (n=${data?.length}):`)
  for (const s of data ?? []) console.log(`  ${s.id}\t${s.name}`)
})()
