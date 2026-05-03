import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } })
;(async () => {
  const { count: total } = await sb.from('customers').select('*', { count: 'exact', head: true })
  const { count: imported } = await sb.from('customers').select('*', { count: 'exact', head: true }).eq('import_source', 'simplybook')
  const { count: notDeleted } = await sb.from('customers').select('*', { count: 'exact', head: true }).is('deleted_at', null)
  const { data: sample } = await sb.from('customers').select('id, store_id, first_name, last_name, email, phone, created_at, deleted_at, import_source').eq('import_source', 'simplybook').limit(3)
  console.log('TOTAL customers in DB:    ', total)
  console.log('Where import_source=simplybook:', imported)
  console.log('Where deleted_at IS NULL: ', notDeleted)
  console.log('Sample imported rows:')
  for (const r of sample ?? []) console.log(' ', JSON.stringify(r))
})()
