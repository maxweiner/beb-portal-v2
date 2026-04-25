// Quiet-hours computation. Pure functions over (now, timezone, settings).
//
// "Quiet hours" is a window like 21:00–08:00 local time during which we
// hold notifications. The dispatcher calls inQuietHours() per row+channel
// (each channel has its own respect_* flag) and reschedules held rows
// to nextQuietHoursEnd() — typically the upcoming 08:00 local.

export interface QuietHoursWindow {
  enabled: boolean
  start: string  // "HH:MM" 24h
  end: string    // "HH:MM" 24h
}

const DEFAULT_WINDOW: QuietHoursWindow = {
  enabled: true,
  start: '21:00',
  end: '08:00',
}

/**
 * Returns the current wall-clock time in the given IANA tz as { hour, minute }.
 * Uses Intl.DateTimeFormat which is supported in Node 18+ and all browsers.
 */
function localHourMinute(now: Date, tz: string): { hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(now)
  const hour = Number(parts.find(p => p.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find(p => p.type === 'minute')?.value ?? '0')
  // Intl returns "24" for midnight on some locales; normalize to 0.
  return { hour: hour === 24 ? 0 : hour, minute }
}

function parseHM(s: string): { hour: number; minute: number } {
  const [h, m] = s.split(':').map(Number)
  return { hour: h || 0, minute: m || 0 }
}

function toMinutes(hm: { hour: number; minute: number }): number {
  return hm.hour * 60 + hm.minute
}

/**
 * True when "now" is inside the quiet-hours window for the given tz.
 * Handles wrapping windows (start > end, e.g. 21:00–08:00) correctly.
 */
export function inQuietHours(
  now: Date,
  tz: string,
  win: QuietHoursWindow = DEFAULT_WINDOW,
): boolean {
  if (!win.enabled) return false
  const local = toMinutes(localHourMinute(now, tz))
  const start = toMinutes(parseHM(win.start))
  const end = toMinutes(parseHM(win.end))
  if (start === end) return false
  return start < end
    ? local >= start && local < end
    : local >= start || local < end
}

/**
 * The next moment quiet hours END in the given tz, as a UTC Date. If
 * not currently in quiet hours, returns the next end after the next
 * start (still useful as a wake time but probably not needed by the
 * caller — they should only ask when held).
 */
export function nextQuietHoursEnd(
  now: Date,
  tz: string,
  win: QuietHoursWindow = DEFAULT_WINDOW,
): Date {
  const end = parseHM(win.end)
  // Build "today's end" and "tomorrow's end" in tz, then convert to UTC.
  // Trick: format the current date in tz to get YYYY-MM-DD, then build
  // a Date from "YYYY-MM-DDTHH:MM:00" + tz offset string. Since tz
  // offsets vary by DST, easier: iterate by 30-min steps from `now`
  // until we land outside quiet hours. Bounded — at most 48 iters.
  const stepMs = 30 * 60 * 1000
  let probe = new Date(now.getTime())
  for (let i = 0; i < 96; i++) {
    probe = new Date(probe.getTime() + stepMs)
    if (!inQuietHours(probe, tz, win)) {
      // Snap back to the exact "end" minute by re-aligning: walk
      // backwards in 1-min steps until we're inside quiet hours,
      // then jump forward 1 min.
      const fineStep = 60 * 1000
      let back = probe
      for (let j = 0; j < 60; j++) {
        const candidate = new Date(back.getTime() - fineStep)
        if (inQuietHours(candidate, tz, win)) return back
        back = candidate
      }
      return probe
    }
  }
  // Fallback — shouldn't reach here unless quiet hours is 24/7 which
  // we treat as disabled at the caller level.
  return new Date(now.getTime() + 8 * 60 * 60 * 1000)
}
