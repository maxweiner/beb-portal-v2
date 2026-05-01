// Tiny client-side helper for inserting customer_events rows from
// the UI / API routes. Tier-change events come from a DB trigger;
// every other event_type is logged here.
//
// Best-effort: we don't fail the parent action if the event insert
// fails. The event log is convenience, not critical state.

import { supabase } from '@/lib/supabase'

export type CustomerEventType =
  | 'created'
  | 'imported'
  | 'edited'
  | 'note_added'
  | 'tag_added'
  | 'tag_removed'
  | 'merged'
  // 'tier_changed' is auto-logged by the DB trigger; clients shouldn't write it.

export async function logCustomerEvent(opts: {
  customerId: string
  type: CustomerEventType
  actorId?: string | null
  description?: string | null
  meta?: Record<string, unknown> | null
}): Promise<void> {
  try {
    await supabase.from('customer_events').insert({
      customer_id: opts.customerId,
      event_type: opts.type,
      actor_id: opts.actorId ?? null,
      description: opts.description ?? null,
      meta: opts.meta ?? null,
    })
  } catch { /* swallow — event log is best-effort */ }
}
