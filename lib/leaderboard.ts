// Leaderboard roster helpers.
//
// The brand switcher already scopes `events` by brand (lib/context.tsx
// filters events.brand server-side), so a "current-year event in this
// brand" is simply any event in the events list whose 3-day window
// overlaps the current calendar year.
//
// A buyer qualifies for the leaderboard if they are in workers[] of at
// least one such event. Inclusion does NOT require any metric activity —
// a buyer assigned to an event with zero appointments still ranks (with
// zero stats).

interface UserLite { id: string; active: boolean; is_buyer?: boolean }
interface EventLite { start_date: string; workers?: { id: string; name: string }[] | null }

/**
 * True if any of the event's 3 days fall within the given calendar year.
 * Multi-day events that straddle Dec 31 → Jan 1 qualify for both years.
 */
export function eventOverlapsYear(ev: EventLite, year: number): boolean {
  if (!ev.start_date) return false
  const start = new Date(ev.start_date + 'T12:00:00')
  const end = new Date(ev.start_date + 'T12:00:00'); end.setDate(end.getDate() + 2)
  return start.getFullYear() <= year && end.getFullYear() >= year
}

/**
 * Returns the set of buyer ids eligible for the leaderboard for `year`.
 * `events` is assumed to be already brand-scoped by the caller.
 */
export function eligibleBuyerIds(events: EventLite[], year: number): Set<string> {
  const ids = new Set<string>()
  for (const ev of events) {
    if (!eventOverlapsYear(ev, year)) continue
    for (const w of ev.workers || []) ids.add(w.id)
  }
  return ids
}

/**
 * Filters `users` down to active, is_buyer-true buyers who have at least
 * one current-calendar-year assignment in `events`. Use this everywhere
 * a "buyer leaderboard" is rendered.
 */
export function leaderboardBuyers<T extends UserLite>(users: T[], events: EventLite[]): T[] {
  const year = new Date().getFullYear()
  const eligible = eligibleBuyerIds(events, year)
  return users.filter(u => u.active && u.is_buyer !== false && eligible.has(u.id))
}

// ── Trade-show day credit ───────────────────────────────────────
// Buyers earn standings days for every completed trade show they
// were staffed on (trade_show_staff join). Each show contributes its
// full inclusive date span (end - start + 1 days). Mirrors the
// buying-event policy in daysWorkedOnEvent(): completed events
// award their full span; in-progress / future shows don't count.

interface TradeShowLite {
  id: string
  start_date: string
  end_date: string
}

interface TradeShowStaffLite {
  user_id: string
  trade_show_id: string
}

/**
 * Days credit per user from completed trade shows in `year`.
 *
 * "Completed" = end_date strictly before today's start-of-day.
 * Year matching uses start_date (same convention as the buying-event
 * filter in Dashboard.tsx, which scopes by `start_date.startsWith(year)`).
 * A staffed user gets credit for the show's full inclusive span.
 *
 * Returns a Map so callers can do `(map.get(userId) ?? 0)` without
 * worrying about missing entries.
 */
export function tradeShowDaysByBuyer(
  staff: TradeShowStaffLite[],
  shows: TradeShowLite[],
  year: number,
  now: Date = new Date(),
): Map<string, number> {
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0)
  const yearStr = String(year)
  const dayMs = 1000 * 60 * 60 * 24
  const byId = new Map(shows.map(s => [s.id, s]))
  const out = new Map<string, number>()
  for (const row of staff) {
    const show = byId.get(row.trade_show_id)
    if (!show?.start_date || !show?.end_date) continue
    if (!show.start_date.startsWith(yearStr)) continue
    const endStart = new Date(show.end_date + 'T00:00:00')
    if (endStart >= todayStart) continue   // not yet completed
    const startStart = new Date(show.start_date + 'T00:00:00')
    const span = Math.round((endStart.getTime() - startStart.getTime()) / dayMs) + 1
    if (span <= 0) continue
    out.set(row.user_id, (out.get(row.user_id) ?? 0) + span)
  }
  return out
}
