// Decides whether an AI report should fire RIGHT NOW.
//
// The cron worker ticks every 15 min, so we use a 15-minute window
// around the scheduled time. The last_sent_at check guards against
// double-firing if a tick straddles the window.
//
// All schedules are interpreted in America/New_York. The cron sees
// the server's UTC clock, so we convert before comparing.

import type { AiReportRow } from './types'

const TZ = 'America/New_York'
const WINDOW_MIN = 15

interface NowInZone {
  hour: number
  minute: number
  dayOfWeek: number     // 0 = Sun
  dayOfMonth: number    // 1..31
  date: Date
}

export function nowInZone(now: Date = new Date()): NowInZone {
  // Intl.DateTimeFormat is the only built-in that handles DST correctly.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
  }).formatToParts(now)

  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '0'
  const weekdayStr = get('weekday')
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  }
  return {
    hour: parseInt(get('hour'), 10) % 24,
    minute: parseInt(get('minute'), 10),
    dayOfWeek: weekdayMap[weekdayStr] ?? 0,
    dayOfMonth: parseInt(get('day'), 10),
    date: now,
  }
}

/** Absolute distance in minutes between two (hour, minute) pairs,
 *  treating them as points on a 24-hour clock face. Going forward or
 *  backward across midnight returns the shorter direction. */
function minutesDistance(h1: number, m1: number, h2: number, m2: number): number {
  const a = h1 * 60 + m1
  const b = h2 * 60 + m2
  const diff = Math.abs(a - b)
  return Math.min(diff, 1440 - diff)
}

/** Hours since last_sent_at. Returns Infinity if never sent. */
function hoursSinceLastSent(report: AiReportRow, now: Date): number {
  if (!report.last_sent_at) return Infinity
  const last = new Date(report.last_sent_at).getTime()
  return (now.getTime() - last) / (1000 * 60 * 60)
}

/** Returns true if this report's schedule says it should fire right
 *  now AND we haven't already fired for this scheduled occurrence. */
export function shouldFireNow(report: AiReportRow, now: Date = new Date()): boolean {
  if (!report.active) return false

  const z = nowInZone(now)
  const dist = minutesDistance(z.hour, z.minute, report.schedule_hour, report.schedule_minute)
  if (dist > WINDOW_MIN) return false

  const hoursSince = hoursSinceLastSent(report, now)

  switch (report.schedule_type) {
    case 'daily':
      // Daily: fire if hour:minute matches AND we haven't sent in >= 23h.
      // 23h (not 24h) gives slack for cron-tick jitter without ever
      // firing twice on the same calendar day.
      return hoursSince >= 23

    case 'weekly':
      if (report.schedule_day_of_week == null) return false
      if (z.dayOfWeek !== report.schedule_day_of_week) return false
      // Weekly: don't re-fire within 6 days. Same jitter slack.
      return hoursSince >= 24 * 6

    case 'monthly':
      if (report.schedule_day_of_month == null) return false
      if (z.dayOfMonth !== report.schedule_day_of_month) return false
      // Monthly: don't re-fire within 27 days. Some months are 28d.
      return hoursSince >= 24 * 27
  }
}

/** Human description of the schedule for UI display. */
export function describeSchedule(report: Pick<
  AiReportRow,
  'schedule_type' | 'schedule_day_of_week' | 'schedule_day_of_month' | 'schedule_hour' | 'schedule_minute'
>): string {
  const t = formatTime(report.schedule_hour, report.schedule_minute)
  switch (report.schedule_type) {
    case 'daily':
      return `Daily at ${t}`
    case 'weekly': {
      const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][report.schedule_day_of_week ?? 0]
      return `Every ${day} at ${t}`
    }
    case 'monthly': {
      const d = report.schedule_day_of_month ?? 1
      const suffix = (d === 1 || d === 21 || d === 31) ? 'st'
        : (d === 2 || d === 22) ? 'nd'
        : (d === 3 || d === 23) ? 'rd'
        : 'th'
      return `Monthly on the ${d}${suffix} at ${t}`
    }
  }
}

function formatTime(h: number, m: number): string {
  const ampm = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm} ET`
}
