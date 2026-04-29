// Cron worker: nag any 'active' expense report whose event started 7+
// days ago. Repeats every 3 days, max 3 reminders per report.
//
// Auth: ?secret=<CRON_SECRET> matching the existing vercel.json
// cron-route convention.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendSubmitReminderForReport } from '@/lib/expenses/sendSubmitReminder'

export const dynamic = 'force-dynamic'

const MAX_REMINDERS = 3
const COOLDOWN_DAYS = 3
const FIRST_NUDGE_DAYS = 7   // event-start + 7 days → first reminder eligible

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
  // Pull active reports with events, filter eligibility in JS so we
  // can use the cleaner JOIN and avoid a complex SQL date expression.
  const { data: rows, error } = await sb
    .from('expense_reports')
    .select('id, status, reminder_count, last_reminder_sent_at, event:events!inner(start_date)')
    .eq('status', 'active')
    .lt('reminder_count', MAX_REMINDERS)
    .lte('event.start_date', todayMinusDaysIso(FIRST_NUDGE_DAYS))
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - COOLDOWN_DAYS)
  const cutoffIso = cutoff.toISOString()

  const eligible = (rows ?? []).filter((r: any) =>
    !r.last_reminder_sent_at || r.last_reminder_sent_at < cutoffIso,
  )
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
  const outcomes = []
  for (const r of eligible) {
    const next = (r.reminder_count ?? 0) + 1
    let result
    try {
      result = await sendSubmitReminderForReport(r.id, next, { portalBaseUrl })
    } catch (err: any) {
      outcomes.push({ id: r.id, ok: false, error: err?.message ?? 'unknown' })
      continue
    }
    if (result.ok) {
      await sb.from('expense_reports')
        .update({ reminder_count: next, last_reminder_sent_at: new Date().toISOString() })
        .eq('id', r.id)
    }
    outcomes.push({ id: r.id, attempt: next, ...result })
  }
  const sent = outcomes.filter(o => o.ok).length
  return NextResponse.json({ ok: true, eligible: eligible.length, sent, failed: eligible.length - sent, outcomes })
}

export async function GET(req: Request) { return run(req) }
export async function POST(req: Request) { return run(req) }
