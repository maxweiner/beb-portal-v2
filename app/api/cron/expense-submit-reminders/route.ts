// Cron worker: nag any 'active' expense report once the event has ended
// (with a small grace period so buyers aren't pinged the moment they
// land at home). Repeats every 3 days, max 3 reminders per report.
//
// Hard rule: never remind while an event is still running or hasn't
// started. The SQL filter expresses this in terms of the 3-day event
// length so the rule survives if FIRST_NUDGE_DAYS is ever tuned to 0.
//
// Auth: ?secret=<CRON_SECRET> matching the existing vercel.json
// cron-route convention.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { EVENT_LENGTH_DAYS, eventEndDate } from '@/lib/eventDates'
import { sendSubmitReminderForReport } from '@/lib/expenses/sendSubmitReminder'

export const dynamic = 'force-dynamic'

const MAX_REMINDERS = 3
const COOLDOWN_DAYS = 3
// Days after the event ENDS before the first nudge fires. Tuned for
// "event over + buyer probably home + had a chance to upload receipts."
const GRACE_DAYS_AFTER_EVENT_END = 4

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

function todayMinusDaysIso(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

async function run(req: Request) {
  const url = new URL(req.url)
  const secret = url.searchParams.get('secret')
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = admin()
  // SQL gate: event start_date must be at least (event-length + grace)
  // days in the past — i.e. the event ended at least GRACE days ago.
  // This is the hard "never remind while an event is in progress" rule.
  const sqlCutoffStartDays = EVENT_LENGTH_DAYS + GRACE_DAYS_AFTER_EVENT_END
  const { data: rows, error } = await sb
    .from('expense_reports')
    .select('id, status, reminder_count, last_reminder_sent_at, event:events!inner(start_date)')
    .eq('status', 'active')
    .lt('reminder_count', MAX_REMINDERS)
    .lte('event.start_date', todayMinusDaysIso(sqlCutoffStartDays))
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - COOLDOWN_DAYS)
  const cutoffIso = cutoff.toISOString()

  // Defense-in-depth: re-verify the event has actually ended, in case
  // EVENT_LENGTH_DAYS ever changes or a row sneaks past the SQL gate.
  const today = new Date()
  const eligible = (rows ?? []).filter((r: any) => {
    if (!r.event?.start_date) return false
    if (eventEndDate(r.event.start_date) > today) return false
    return !r.last_reminder_sent_at || r.last_reminder_sent_at < cutoffIso
  })
  if (eligible.length === 0) {
    return NextResponse.json({ ok: true, eligible: 0 })
  }

  // Vercel cron requests hit the deployment-hash hostname, not the
  // production domain — building the link from req.host produced
  // emails that 404'd. Use the canonical portal URL instead.
  const portalBaseUrl =
    process.env.NEXT_PUBLIC_BOOKING_BASE_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || 'https://beb-portal-v2.vercel.app'

  // Need owner ids so we can dedupe per buyer. The earlier select
  // doesn't return user_id; pull it now in one round-trip.
  const { data: ownerRows } = await sb
    .from('expense_reports')
    .select('id, user_id')
    .in('id', eligible.map((r: any) => r.id))
  const ownerById = new Map<string, string>()
  for (const o of (ownerRows || [])) ownerById.set(o.id as string, o.user_id as string)

  // Group eligible reports by buyer. Send AT MOST one reminder per
  // buyer per cron run — a buyer with 20 untouched reports gets
  // one email about their oldest pending one, not 20. Cooldown is
  // applied to ALL their eligible rows so the next cron leaves
  // them alone for COOLDOWN_DAYS regardless of report count.
  const byBuyer = new Map<string, any[]>()
  for (const r of eligible) {
    const uid = ownerById.get(r.id)
    if (!uid) continue
    if (!byBuyer.has(uid)) byBuyer.set(uid, [])
    byBuyer.get(uid)!.push(r)
  }

  const outcomes: any[] = []
  for (const [uid, list] of byBuyer.entries()) {
    // Oldest event first → that's the report we name in the email.
    list.sort((a, b) => (a.event?.start_date || '').localeCompare(b.event?.start_date || ''))
    const target = list[0]
    const next = (target.reminder_count ?? 0) + 1

    let result
    try {
      result = await sendSubmitReminderForReport(target.id, next, { portalBaseUrl })
    } catch (err: any) {
      outcomes.push({ buyer: uid, id: target.id, ok: false, error: err?.message ?? 'unknown' })
      continue
    }

    const nowIso = new Date().toISOString()
    if (result.ok) {
      // Bump reminder_count on the report we actually emailed about
      // — cap at MAX_REMINDERS still applies per report.
      await sb.from('expense_reports')
        .update({ reminder_count: next, last_reminder_sent_at: nowIso })
        .eq('id', target.id)
      // Cooldown-stamp the rest of this buyer's eligible reports
      // (without bumping their counts). Prevents the cron from
      // emailing this buyer again for COOLDOWN_DAYS no matter how
      // many other reports they have.
      const otherIds = list.slice(1).map(r => r.id)
      if (otherIds.length > 0) {
        await sb.from('expense_reports')
          .update({ last_reminder_sent_at: nowIso })
          .in('id', otherIds)
      }
    }
    outcomes.push({ buyer: uid, id: target.id, attempt: next, suppressed: list.length - 1, ...result })
  }

  const sent = outcomes.filter(o => o.ok).length
  const suppressed = outcomes.reduce((s, o) => s + (o.suppressed || 0), 0)
  return NextResponse.json({
    ok: true,
    eligible: eligible.length,
    buyers: byBuyer.size,
    sent,
    suppressed,
    failed: outcomes.length - sent,
    outcomes,
  })
}

export async function GET(req: Request) { return run(req) }
export async function POST(req: Request) { return run(req) }
