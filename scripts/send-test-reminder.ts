// Local-only: send a single submit-reminder email for one specific
// expense report so we can eyeball the link in the email without
// triggering the cron (which would nag every eligible user).
//
// Run: npx tsx scripts/send-test-reminder.ts <user-email> <event-store-keyword>
// e.g.: npx tsx scripts/send-test-reminder.ts max.weiner@gmail.com Daniels
//
// Sends but does NOT bump reminder_count or last_reminder_sent_at —
// this is purely a test send.

import { createClient } from '@supabase/supabase-js'
import { sendSubmitReminderForReport } from '../lib/expenses/sendSubmitReminder'

async function main() {
  const [, , userEmail, storeKeyword] = process.argv
  if (!userEmail || !storeKeyword) {
    console.error('Usage: tsx scripts/send-test-reminder.ts <user-email> <event-store-keyword>')
    process.exit(2)
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )

  const { data: user, error: uErr } = await sb.from('users')
    .select('id, name, email').eq('email', userEmail).maybeSingle()
  if (uErr || !user) { console.error('User not found:', userEmail, uErr?.message); process.exit(1) }

  const { data: rows, error: rErr } = await sb
    .from('expense_reports')
    .select('id, status, reminder_count, event:events!inner(store_name, start_date)')
    .eq('user_id', user.id)
    .ilike('event.store_name', `%${storeKeyword}%`)
    .order('created_at', { ascending: false })
  if (rErr) { console.error('Lookup failed:', rErr.message); process.exit(1) }
  if (!rows || rows.length === 0) {
    console.error(`No reports found for ${user.email} matching event "${storeKeyword}"`)
    process.exit(1)
  }

  console.log(`Found ${rows.length} matching report(s) for ${user.name} <${user.email}>:`)
  for (const r of rows as any[]) {
    console.log(`  - ${r.id} · status=${r.status} · ${r.event?.store_name} (${r.event?.start_date}) · reminders=${r.reminder_count ?? 0}`)
  }
  const target = (rows as any[]).find(r => r.status === 'active') ?? (rows as any[])[0]
  console.log(`\nUsing report: ${target.id}`)

  const portalBaseUrl = 'https://beb-portal-v2.vercel.app'
  const result = await sendSubmitReminderForReport(target.id, 1, { portalBaseUrl })
  console.log('Result:', result)
}
main().catch(e => { console.error(e); process.exit(1) })
