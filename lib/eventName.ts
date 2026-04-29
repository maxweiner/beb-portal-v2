// Event display name resolver. event.store_name is a snapshot we
// take at creation time; the live store row is the source of truth
// once the partner edits the store. Always prefer the live name when
// available, fall back to the snapshot for legacy / orphaned events.

import type { Event, Store } from '@/types'

export function eventDisplayName(
  ev: Pick<Event, 'store_id' | 'store_name'> | null | undefined,
  stores: Pick<Store, 'id' | 'name'>[],
): string {
  if (!ev) return ''
  const live = stores.find(s => s.id === ev.store_id)?.name
  return live || ev.store_name || ''
}
