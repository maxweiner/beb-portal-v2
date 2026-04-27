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
