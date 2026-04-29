// Quiet-hours math for the accountant email. Business hours: Mon-Fri,
// 7:00-21:00 Eastern (where the accountant lives). Anything else is
// quiet — accountant email gets deferred to the next business-hours
// moment via /api/cron/expense-quiet-hours-flush.
//
// All time math is done in America/New_York via Intl.DateTimeFormat
// so DST transitions are handled by the platform.

const TZ = 'America/New_York'

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
}

interface EtParts {
  year: number
  month: number   // 1-12
  day: number
  hour: number    // 0-23
  minute: number
  weekday: number // 0=Sun … 6=Sat
}

function partsInEt(d: Date): EtParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
    hour12: false,
  }).formatToParts(d)
  const get = (t: string) => fmt.find(p => p.type === t)?.value ?? ''
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,   // hour12=false sometimes yields '24'
    minute: Number(get('minute')),
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
  }
}

/**
 * Construct a Date that, when interpreted in ET, has the given Y/M/D h:m.
 * Tries both EST (-05:00) and EDT (-04:00); returns whichever yields the
 * requested local parts when re-rendered in the TZ. Handles DST cleanly.
 */
function dateFromEt(year: number, month: number, day: number, hour: number, minute: number): Date {
  for (const offset of ['-05:00', '-04:00']) {
    const iso = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00${offset}`
    const candidate = new Date(iso)
    const p = partsInEt(candidate)
    if (p.year === year && p.month === month && p.day === day && p.hour === hour && p.minute === minute) {
      return candidate
    }
  }
  // Fallback for the spring-forward 2-3am gap or other edge cases.
  return new Date(`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00-05:00`)
}

function addDaysUtc(year: number, month: number, day: number, n: number): { y: number; m: number; d: number } {
  const t = Date.UTC(year, month - 1, day) + n * 24 * 60 * 60 * 1000
  const d = new Date(t)
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }
}

/**
 * Returns null when `now` is inside business hours (send immediately).
 * Otherwise returns a Date for the next business-hours moment in ET
 * (Mon-Fri 7:00am).
 */
export function nextBusinessHoursMomentEt(now: Date = new Date()): Date | null {
  const p = partsInEt(now)
  const isWeekend = p.weekday === 0 || p.weekday === 6
  const isQuietHour = p.hour < 7 || p.hour >= 21
  if (!isWeekend && !isQuietHour) return null

  // Land on the next valid weekday at 7:00 ET.
  // If it's already past today's 7am, skip to tomorrow.
  let { y, m, d } = { y: p.year, m: p.month, d: p.day }
  if (p.hour >= 7) {
    const next = addDaysUtc(y, m, d, 1)
    y = next.y; m = next.m; d = next.d
  }
  // Skip Saturdays + Sundays.
  // Cap the loop at 7 days; weekend can be at most 2 consecutive days.
  for (let i = 0; i < 7; i++) {
    const candidate = dateFromEt(y, m, d, 7, 0)
    const cp = partsInEt(candidate)
    if (cp.weekday !== 0 && cp.weekday !== 6 && candidate.getTime() > now.getTime()) {
      return candidate
    }
    const next = addDaysUtc(y, m, d, 1)
    y = next.y; m = next.m; d = next.d
  }
  // Should be unreachable.
  return null
}

/** Convenience: is `now` inside business hours? */
export function isBusinessHoursEt(now: Date = new Date()): boolean {
  return nextBusinessHoursMomentEt(now) === null
}
