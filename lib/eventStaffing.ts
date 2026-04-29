// Single source of truth for the "is this event understaffed?" check.
// Every renderer (event card, dashboard tile, calendar chip) imports
// this so the rules stay consistent.
//
// Rules (per spec):
//   - buyers_needed NULL → no hazard (legacy events).
//   - buyers_needed <= 0 → no hazard (defensive; CHECK constraint blocks).
//   - Past events → no hazard (event end_date < today).
//   - Cancelled / archived events → no hazard. Today the events table has
//     no status column for that, so this branch is a no-op until one
//     is added. (Plain delete-from-DB removes the row entirely.)
//   - Otherwise hazard fires when assigned worker count < buyers_needed.

import type { Event } from '@/types'

export interface UnderstaffedInfo {
  understaffed: boolean
  assigned: number
  needed: number | null
}

const ASSUMED_EVENT_LENGTH_DAYS = 3   // start_date + 2

function todayIsoLocal(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function eventStaffing(
  ev: Pick<Event, 'workers' | 'start_date'> & { buyers_needed?: number | null },
): UnderstaffedInfo {
  const needed = (ev.buyers_needed ?? null)
  const assigned = (ev.workers || [])
    .filter(w => !(w as any).deleted)
    .length

  if (needed == null || needed <= 0) {
    return { understaffed: false, assigned, needed }
  }

  // Past events never show the hazard. End ≈ start + (length - 1) days.
  if (ev.start_date) {
    const start = new Date(ev.start_date + 'T12:00:00')
    const end = new Date(start)
    end.setDate(end.getDate() + (ASSUMED_EVENT_LENGTH_DAYS - 1))
    const endIso = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`
    if (endIso < todayIsoLocal()) {
      return { understaffed: false, assigned, needed }
    }
  }

  return { understaffed: assigned < needed, assigned, needed }
}

/** Convenience: just the boolean. */
export function isUnderstaffed(ev: Parameters<typeof eventStaffing>[0]): boolean {
  return eventStaffing(ev).understaffed
}
