// Sample phone storage formats — imported vs pre-existing.
import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } })

;(async () => {
  const { data: pre } = await sb
    .from('customers')
    .select('phone')
    .neq('import_source', 'simplybook')
    .not('phone', 'is', null)
    .limit(8)
  console.log('Sample pre-import phones:')
  for (const r of pre ?? []) console.log(`  ${JSON.stringify(r.phone)}`)

  const { data: imp } = await sb
    .from('customers')
    .select('phone')
    .eq('import_source', 'simplybook')
    .not('phone', 'is', null)
    .limit(5)
  console.log('\nSample imported phones:')
  for (const r of imp ?? []) console.log(`  ${JSON.stringify(r.phone)}`)
})()
