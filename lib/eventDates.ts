// Shared date helpers for events. The portal treats every event as a
// fixed 3-day span starting on `start_date` (events have no end_date
// column today). Both this file and lib/eventStaffing.ts encode that
// assumption — keep them in sync if it ever becomes configurable.

export const EVENT_LENGTH_DAYS = 3

/** Local end-of-day Date for the last day of the event (start + 2). */
export function eventEndDate(startIso: string): Date {
  const d = new Date(startIso + 'T12:00:00')
  d.setDate(d.getDate() + (EVENT_LENGTH_DAYS - 1))
  d.setHours(23, 59, 59, 999)
  return d
}

/** "YYYY-MM-DD" of the event's last day. */
export function eventEndIso(startIso: string): string {
  const d = eventEndDate(startIso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Format an event's date range. 3-day events span start..start+2.
 *   "Mar 11–14, 2026"        same month
 *   "Feb 28 – Mar 2, 2026"   crosses a month boundary
 */
export function formatEventRange(startIso: string): string {
  const start = new Date(startIso + 'T12:00:00')
  const end = new Date(start); end.setDate(end.getDate() + (EVENT_LENGTH_DAYS - 1))
  const sm = start.toLocaleDateString('en-US', { month: 'short' })
  const em = end.toLocaleDateString('en-US', { month: 'short' })
  const year = start.getFullYear()
  return sm !== em
    ? `${sm} ${start.getDate()} – ${em} ${end.getDate()}, ${year}`
    : `${sm} ${start.getDate()}–${end.getDate()}, ${year}`
}

/** Mon-00:00 → Sun-23:59 of the calendar week containing `d` (default today). */
export function weekRange(d: Date = new Date()): { start: Date; end: Date } {
  const start = new Date(d); start.setHours(0, 0, 0, 0)
  const day = start.getDay()
  start.setDate(start.getDate() - (day === 0 ? 6 : day - 1))
  const end = new Date(start); end.setDate(end.getDate() + 6); end.setHours(23, 59, 59, 999)
  return { start, end }
}

/** True if any of the event's 3 days falls inside [weekStart..weekEnd]. */
export function eventOverlapsWeek(
  ev: { start_date?: string | null },
  weekStart: Date,
  weekEnd: Date,
): boolean {
  if (!ev.start_date) return false
  const evStart = new Date(ev.start_date + 'T00:00:00')
  const evEnd = eventEndDate(ev.start_date)
  return evStart <= weekEnd && evEnd >= weekStart
}

/**
 * Days "worked" on this event for leaderboard counting. Past events
 * count as the full 3 days; current/future count entered days only.
 */
export function daysWorkedOnEvent(ev: { start_date?: string | null; days?: unknown[] | null }): number {
  if (!ev.start_date) return 0
  return eventEndDate(ev.start_date) < new Date() ? EVENT_LENGTH_DAYS : (ev.days?.length ?? 0)
}
