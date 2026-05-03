// Deeper dive: did the multi-role / role-modules / impersonation
// changes break what RLS / role-gating sees?
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } }
)

;(async () => {
  // 1. Full users row + role_modules
  const { data, error } = await sb
    .from('users').select('*').eq('email', 'max@bebllp.com').single()
  if (error) { console.error('users select error:', error); process.exit(1) }
  const trimmed = { ...data, photo_url: data.photo_url ? `<base64 ${data.photo_url.length} chars>` : null }
  console.log('FULL users row for max@bebllp.com:')
  console.log(JSON.stringify(trimmed, null, 2))

  // 2. RLS policy text for customers
  const { data: pols, error: polErr } = await sb
    .from('pg_policies')
    .select('schemaname, tablename, policyname, permissive, cmd, qual, with_check')
    .eq('tablename', 'customers')
  if (polErr) console.log('(could not read pg_policies via REST — expected)')
  else console.log('\nCustomers RLS policies:', JSON.stringify(pols, null, 2))
})()
