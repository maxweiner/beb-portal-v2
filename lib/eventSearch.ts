// Shared free-text search for events. Originally inlined in Events.tsx;
// extracted so the Day Entry picker can mirror its exact matching
// behavior (case-insensitive substring across event store_name + the
// joined store's name / city / state).

import type { Event, Store } from '@/types'

/**
 * Filter events by a free-text query. Case-insensitive substring
 * match against the event's snapshot store_name plus the live store's
 * name, city, and state. Empty / whitespace-only query returns the
 * original list unchanged.
 */
export function searchEvents(events: Event[], query: string, stores: Store[]): Event[] {
  const q = query.trim().toLowerCase()
  if (!q) return events
  return events.filter(ev => {
    const store = stores.find(s => s.id === ev.store_id)
    return (
      (ev.store_name || '').toLowerCase().includes(q) ||
      (store?.name  || '').toLowerCase().includes(q) ||
      (store?.city  || '').toLowerCase().includes(q) ||
      (store?.state || '').toLowerCase().includes(q)
    )
  })
}
