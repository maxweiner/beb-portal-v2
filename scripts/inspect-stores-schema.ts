// Probe the live stores table to see what columns/defaults exist.
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } }
)

;(async () => {
  const { data, error } = await sb.from('stores').select('*').limit(1)
  if (error) { console.error(error); process.exit(1) }
  if (!data?.length) { console.log('(empty)'); return }
  console.log('columns:', Object.keys(data[0]))
  console.log('sample row:', JSON.stringify(data[0], null, 2))
})()
