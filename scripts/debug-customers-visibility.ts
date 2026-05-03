// Diagnose why imported customers aren't visible in the UI.
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } }
)

;(async () => {
  // 1. Confirm Max's user row + role
  const { data: maxRows } = await sb
    .from('users')
    .select('id, email, role, is_partner')
    .or('email.ilike.%max%,email.ilike.%weiner%')
  console.log('users matching max/weiner:')
  console.log(JSON.stringify(maxRows, null, 2))

  const { data: admins } = await sb
    .from('users')
    .select('id, email, role')
    .in('role', ['admin', 'superadmin'])
  console.log('\nAll admin/superadmin users:')
  for (const a of admins ?? []) console.log(`  ${a.role.padEnd(12)} ${a.email}`)
  const u = (maxRows ?? []).find(r => r.email === 'max@bebllp.com')!
  console.log(`\nMAX user_id: ${u.id} role=${u.role}`)

  // 2b. user_roles entries for max
  const { data: ur2 } = await sb.from('user_roles').select('*').eq('user_id', u.id)
  console.log(`user_roles for max: ${JSON.stringify(ur2)}`)

  // 2c. Total user_roles in DB
  const { count: urCount } = await sb.from('user_roles').select('*', { count: 'exact', head: true })
  console.log(`Total user_roles rows in DB: ${urCount}`)

  // 2d. Try to read a customer as if I'm Max, by impersonating his auth.uid via PostgREST? Not directly possible without a JWT.
  // Instead, just print the policies via information_schema.
  const { data: pol } = await sb
    .rpc('exec_sql' as any, { sql: "SELECT polname, pg_get_expr(polqual, polrelid) AS using_expr FROM pg_policy WHERE polrelid='customers'::regclass" })
  if (pol) console.log('Customer RLS policies:', pol)

  // 2. user_roles join table (multi-role initiative)
  const { data: ur } = await sb
    .from('user_roles')
    .select('role')
    .eq('user_id', u?.id)
  console.log('\nuser_roles entries:', ur)

  // 3. Does Customers RLS still gate on role IN ('admin','superadmin')?
  const { data: pols } = await sb.rpc('pg_policies_for', { tbl: 'customers' })
  if (pols) console.log('\nRLS policies on customers:', pols)

  // 4. Sample two stores' customer counts
  const { data: stores } = await sb.from('stores').select('id, name').in('name', ['Sami Fine Jewelers','Alan Miller Jewelers','Tracy Jewelers']).limit(3)
  for (const s of stores ?? []) {
    const { count } = await sb.from('customers')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', s.id).is('deleted_at', null)
    console.log(`\nstore "${s.name}" (${s.id}): ${count} customers visible (deleted_at IS NULL)`)
  }
})()
