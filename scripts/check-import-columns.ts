// Quick probe: confirm phase-13 migration columns exist before running import.
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } }
)

;(async () => {
  const { error } = await sb
    .from('customers')
    .select('id, import_source, import_batch_id')
    .limit(1)
  if (error) {
    console.error('PROBE FAILED:', error.message)
    process.exit(1)
  }
  console.log('OK — import_source and import_batch_id columns exist on customers.')
})()
