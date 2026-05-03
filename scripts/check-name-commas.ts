import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } })
;(async () => {
  // Commas in first_name when last_name IS set
  const { data, count } = await sb.from('customers')
    .select('id, first_name, last_name', { count: 'exact' })
    .like('first_name', '%,%')
    .not('last_name', 'is', null).neq('last_name', '')
    .eq('import_source', 'simplybook')
    .limit(10)
  console.log(`first_name with comma BUT last_name IS set: ${count}`)
  for (const r of data ?? []) console.log(`  first=${JSON.stringify(r.first_name)}  last=${JSON.stringify(r.last_name)}`)

  // Commas in last_name
  const { data: d2, count: c2 } = await sb.from('customers')
    .select('id, first_name, last_name', { count: 'exact' })
    .like('last_name', '%,%')
    .eq('import_source', 'simplybook')
    .limit(10)
  console.log(`\nlast_name with comma: ${c2}`)
  for (const r of d2 ?? []) console.log(`  first=${JSON.stringify(r.first_name)}  last=${JSON.stringify(r.last_name)}`)
})()
