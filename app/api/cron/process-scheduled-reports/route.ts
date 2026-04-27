// Scheduled reports dispatcher.
//
// Reads enabled rows from report_template_schedules, computes whether
// each is due (based on frequency + time_of_day + last_sent_at), then
// invokes the template's data-assembly function with the per-(template,
// brand) recipients list and stamps last_sent_at on success.
//
// PR 1: dispatcher exists but is NOT in vercel.json crons. Trigger
// manually via /api/cron/process-scheduled-reports?secret=... for
// testing. PR 3 swaps the cron over.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendDailyBriefing, fetchTemplateRecipients, type Brand } from '@/lib/reports/dailyBriefing'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

interface ScheduleRow {
  template_id: string
  brand: Brand
  enabled: boolean
  frequency: 'daily' | 'weekly' | 'monthly'
  time_of_day: string  // 'HH:MM:SS'
  weekly_day: number | null
  monthly_day: number | null
  last_sent_at: string | null
  report_templates: {
    id: string
    subject: string
    greeting: string
    header_subtitle: string
    footer: string
    enabled: boolean
    send_implemented: boolean
  } | null
}

export async function GET(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret') || request.nextUrl.searchParams.get('secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dryRun = request.nextUrl.searchParams.get('dryRun') === '1'
  const now = new Date()

  const { data, error } = await sb.from('report_template_schedules')
    .select(`
      template_id, brand, enabled, frequency, time_of_day,
      weekly_day, monthly_day, last_sent_at,
      report_templates (id, subject, greeting, header_subtitle, footer, enabled, send_implemented)
    `)
    .eq('enabled', true)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const schedules = (data || []) as unknown as ScheduleRow[]
  const results: any[] = []

  for (const sched of schedules) {
    if (!sched.report_templates?.enabled) {
      results.push({ template: sched.template_id, brand: sched.brand, skipped: 'template disabled' })
      continue
    }
    if (!sched.report_templates.send_implemented) {
      results.push({ template: sched.template_id, brand: sched.brand, skipped: 'no data assembly wired' })
      continue
    }
    if (!isDue(sched, now)) {
      results.push({ template: sched.template_id, brand: sched.brand, skipped: 'not due' })
      continue
    }

    if (dryRun) {
      results.push({ template: sched.template_id, brand: sched.brand, skipped: 'dryRun' })
      continue
    }

    const recipients = await fetchTemplateRecipients(sched.template_id, sched.brand)
    let result: any
    switch (sched.template_id) {
      case 'daily-briefing':
        result = await sendDailyBriefing({
          brand: sched.brand,
          recipients,
          template: sched.report_templates,
        })
        break
      default:
        result = { skipped: `no dispatcher case for ${sched.template_id}` }
    }

    if (result.sent) {
      await sb.from('report_template_schedules')
        .update({ last_sent_at: now.toISOString() })
        .eq('template_id', sched.template_id)
        .eq('brand', sched.brand)
    }
    results.push({ template: sched.template_id, brand: sched.brand, ...result })
  }

  return NextResponse.json({ ok: true, ranAt: now.toISOString(), processed: results })
}

/** Has the schedule's most recent fire-window passed without a send yet? */
function isDue(sched: ScheduleRow, now: Date): boolean {
  // Compute the most recent moment the schedule should have fired (in UTC).
  const lastWindow = lastFireWindow(sched, now)
  if (!lastWindow) return false
  if (now < lastWindow) return false
  if (!sched.last_sent_at) return true
  return new Date(sched.last_sent_at) < lastWindow
}

function lastFireWindow(sched: ScheduleRow, now: Date): Date | null {
  const [h, m] = sched.time_of_day.split(':').map(Number)

  if (sched.frequency === 'daily') {
    // Today at HH:MM UTC if that's already passed; otherwise yesterday at HH:MM UTC.
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m, 0))
    return now >= today ? today : new Date(today.getTime() - 86400000)
  }

  if (sched.frequency === 'weekly') {
    if (sched.weekly_day == null) return null
    // Convert "Monday=0..Sunday=6" to JS "Sunday=0..Saturday=6"
    const targetJsDow = (sched.weekly_day + 1) % 7
    const todayJsDow = now.getUTCDay()
    const daysSinceTarget = (todayJsDow - targetJsDow + 7) % 7
    const candidate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceTarget, h, m, 0))
    return now >= candidate ? candidate : new Date(candidate.getTime() - 7 * 86400000)
  }

  if (sched.frequency === 'monthly') {
    if (sched.monthly_day == null) return null
    const dayThisMonth = clampDayToMonth(now.getUTCFullYear(), now.getUTCMonth(), sched.monthly_day)
    const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), dayThisMonth, h, m, 0))
    if (now >= thisMonth) return thisMonth
    const prevYear = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear()
    const prevMonth = now.getUTCMonth() === 0 ? 11 : now.getUTCMonth() - 1
    const dayPrevMonth = clampDayToMonth(prevYear, prevMonth, sched.monthly_day)
    return new Date(Date.UTC(prevYear, prevMonth, dayPrevMonth, h, m, 0))
  }

  return null
}

/** If schedule says "31st" but the month has 30 days, fire on the last day. */
function clampDayToMonth(year: number, monthIdx: number, day: number): number {
  const lastDay = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate()
  return Math.min(day, lastDay)
}
