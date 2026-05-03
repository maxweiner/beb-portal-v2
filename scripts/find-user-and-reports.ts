// Quick lookup: dump all users matching a name + their reports.
import { createClient } from '@supabase/supabase-js'

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
  const userId = '8dca2918-26ee-4b0b-a169-77bb2f8ae362'
  const { data: reports } = await sb.from('expense_reports')
    .select('id, status, reminder_count, last_reminder_sent_at, event:events!inner(store_name, start_date)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  console.log(`All expense reports for user ${userId} (${(reports || []).length}):`)
  for (const r of (reports as any[]) || []) {
    console.log(` - ${r.id} · ${r.status} · reminders=${r.reminder_count ?? 0} · last=${r.last_reminder_sent_at ?? '-'} · ${r.event?.store_name} (${r.event?.start_date})`)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
