// Schedule-send time helpers.
//
// nineAmInTz(date, tz) returns a UTC Date representing 9:00 AM on
// `date` in `tz`. Used by /api/communications/schedule to resolve a
// user-picked date + the recipient store's tz into a stable UTC
// timestamp the cron worker can compare against now().
//
// Implementation: ask Intl.DateTimeFormat what UTC noon looks like in
// the target tz, derive the offset, then back-compute UTC for 9 AM
// local. DST transitions happen at 2 AM local (in the US) which is
// safely away from 9 AM, so the single-pass algorithm is correct
// year-round.

import { STATE_TZ } from '@/lib/calendar'

export function tzForState(state: string | null | undefined): string {
  const code = (state || '').toUpperCase()
  return STATE_TZ[code] || 'America/New_York'
}

export function nineAmInTz(dateYMD: string, tz: string): Date {
  // dateYMD = "2026-05-15", tz = "America/Los_Angeles"
  const utc12noon = new Date(`${dateYMD}T12:00:00Z`)
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  })
  const parts = dtf.formatToParts(utc12noon)
  const seenH = parseInt(parts.find(p => p.type === 'hour')?.value || '12', 10)
  // Hour = 24 represents midnight in some locales; treat as 0.
  const localHour = seenH === 24 ? 0 : seenH
  const offsetHours = localHour - 12
  const utcHour = 9 - offsetHours
  const utc = new Date(`${dateYMD}T00:00:00Z`)
  utc.setUTCHours(utcHour)
  return utc
}
