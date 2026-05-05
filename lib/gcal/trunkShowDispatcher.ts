// Per-row dispatcher for trunk_show_gcal_sync_queue. Called by the
// every-minute Vercel cron worker after claim_due_trunk_show_syncs
// has flipped the row to 'processing'.
//
// Two action types:
//
//   'sync'   → look up the trunk show + assigned rep + existing link
//              and reconcile (create / update / reassign / no-op).
//   'delete' → use the snapshot to remove the Google event without
//              needing the trunk_show row to still exist.
//
// Reassignment behavior:
//   - Old link exists, rep changed   → delete from old calendar,
//                                      create on new calendar,
//                                      replace link row.
//   - Old link exists, rep cleared   → delete from old calendar,
//                                      drop link row.
//   - No old link, no rep / no cal   → nothing to do.
//
// Cancelled or soft-deleted shows: treated as delete (remove from
// the rep's calendar; the link row is dropped so a re-activation
// re-creates the event cleanly).
//
// On failure: 3-attempt exponential backoff (1m, 5m, 15m). After
// the 3rd attempt, mark failed.

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { createGcalEvent, deleteGcalEvent, patchGcalEvent, type GcalEventInput } from './client'

const RETRY_BACKOFF_MINUTES = [1, 5, 15]
const MAX_ATTEMPTS = RETRY_BACKOFF_MINUTES.length

let _client: SupabaseClient | null = null
function admin(): SupabaseClient {
  if (_client) return _client
  _client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
  return _client
}

function portalUrl(): string {
  return (
    process.env.NEXT_PUBLIC_PORTAL_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    'https://beb-portal-v2.vercel.app'
  )
}

interface QueueRow {
  id: string
  trunk_show_id: string | null
  action: 'sync' | 'delete'
  snapshot: any
  attempts: number
  status: string
}

/**
 * Build the Google event body from a trunk-show row joined with its
 * store. Google's all-day end is exclusive — we add a day to the
 * end_date so a 3-day show occupies the right number of cells.
 */
function buildEventInput(show: any, store: any): GcalEventInput {
  const storeName = store?.name || 'Trunk Show'
  const summary = show.vip_showing
    ? `⭐ ${storeName} (VIP)`
    : storeName
  const locParts = [store?.address_1, store?.city, store?.state].filter(Boolean)
  const description =
    `Status: ${show.status}` +
    (show.vip_showing ? ' · VIP showing' : '') +
    (show.notes ? `\n\nNotes: ${show.notes}` : '')
  const endExclusive = (() => {
    const d = new Date(show.end_date + 'T12:00:00')
    d.setDate(d.getDate() + 1)
    return d.toISOString().slice(0, 10)
  })()
  return {
    summary,
    description,
    location: locParts.join(', ') || undefined,
    startDate: show.start_date,
    endDate: endExclusive,
    source: { title: 'BEB Portal', url: `${portalUrl()}/trunk-shows` },
  }
}

async function markDone(rowId: string, note?: string): Promise<void> {
  await admin().from('trunk_show_gcal_sync_queue').update({
    status: 'done',
    last_error: note || null,
    processed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', rowId)
}

async function markFailureOrRetry(rowId: string, attempts: number, err: string): Promise<void> {
  if (attempts + 1 >= MAX_ATTEMPTS) {
    await admin().from('trunk_show_gcal_sync_queue').update({
      status: 'failed',
      attempts: attempts + 1,
      last_error: err,
      processed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', rowId)
    return
  }
  const delayMs = RETRY_BACKOFF_MINUTES[attempts] * 60 * 1000
  await admin().from('trunk_show_gcal_sync_queue').update({
    status: 'pending',
    attempts: attempts + 1,
    last_error: err,
    scheduled_for: new Date(Date.now() + delayMs).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', rowId)
}

export async function dispatchOneTrunkShowSync(row: QueueRow): Promise<{ rowId: string; outcome: string; error?: string }> {
  const sb = admin()

  try {
    if (row.action === 'delete') {
      const snap = row.snapshot || {}
      if (!snap.calendar_id || !snap.google_event_id) {
        await markDone(row.id, 'no_snapshot')
        return { rowId: row.id, outcome: 'no_snapshot' }
      }
      await deleteGcalEvent(snap.calendar_id, snap.google_event_id)
      await markDone(row.id, 'deleted')
      return { rowId: row.id, outcome: 'deleted' }
    }

    // action === 'sync'
    if (!row.trunk_show_id) {
      await markDone(row.id, 'no_trunk_show_id')
      return { rowId: row.id, outcome: 'no_trunk_show_id' }
    }

    // 1. Load the trunk show.
    const { data: show, error: showErr } = await sb
      .from('trunk_shows')
      .select('id, store_id, start_date, end_date, assigned_rep_id, status, vip_showing, notes, deleted_at')
      .eq('id', row.trunk_show_id)
      .maybeSingle()
    if (showErr) throw new Error(`load show: ${showErr.message}`)

    // 2. Load existing link.
    const { data: link } = await sb
      .from('trunk_show_gcal_event_links')
      .select('rep_user_id, calendar_id, google_calendar_event_id')
      .eq('trunk_show_id', row.trunk_show_id)
      .maybeSingle()

    // 3. Effectively-deleted (gone, soft-deleted, or cancelled) → remove if linked.
    const effectivelyGone =
      !show
      || show.deleted_at !== null
      || show.status === 'cancelled'

    if (effectivelyGone) {
      if (link) {
        await deleteGcalEvent(link.calendar_id, link.google_calendar_event_id)
        await sb.from('trunk_show_gcal_event_links').delete().eq('trunk_show_id', row.trunk_show_id)
        await markDone(row.id, 'removed')
        return { rowId: row.id, outcome: 'removed' }
      }
      await markDone(row.id, 'no_op_already_gone')
      return { rowId: row.id, outcome: 'no_op_already_gone' }
    }

    // 4. Resolve assigned rep + their calendar.
    if (!show.assigned_rep_id) {
      // No rep — if a link exists from a previous assignment, clean up.
      if (link) {
        await deleteGcalEvent(link.calendar_id, link.google_calendar_event_id)
        await sb.from('trunk_show_gcal_event_links').delete().eq('trunk_show_id', row.trunk_show_id)
        await markDone(row.id, 'unassigned_removed')
        return { rowId: row.id, outcome: 'unassigned_removed' }
      }
      await markDone(row.id, 'unassigned')
      return { rowId: row.id, outcome: 'unassigned' }
    }

    const { data: rep } = await sb
      .from('users')
      .select('id, trunk_show_calendar_id')
      .eq('id', show.assigned_rep_id)
      .maybeSingle()

    if (!rep || !rep.trunk_show_calendar_id) {
      // Rep has no calendar provisioned yet. Don't fail — leave for a
      // later retry once the admin sets one up. Mark done and rely on
      // the next mutation (or PR D's backfill) to re-enqueue.
      await markDone(row.id, 'rep_no_calendar')
      return { rowId: row.id, outcome: 'rep_no_calendar' }
    }

    // 5. Load store (for the event payload).
    const { data: store } = await sb
      .from('trunk_show_stores')
      .select('name, address_1, city, state')
      .eq('id', show.store_id)
      .maybeSingle()

    const payload = buildEventInput(show, store)

    if (!link) {
      // No prior link → create.
      const created = await createGcalEvent(rep.trunk_show_calendar_id, payload)
      await sb.from('trunk_show_gcal_event_links').upsert({
        trunk_show_id: show.id,
        rep_user_id: rep.id,
        calendar_id: rep.trunk_show_calendar_id,
        google_calendar_event_id: created.id,
        updated_at: new Date().toISOString(),
      })
      await markDone(row.id, 'created')
      return { rowId: row.id, outcome: 'created' }
    }

    if (link.rep_user_id !== rep.id || link.calendar_id !== rep.trunk_show_calendar_id) {
      // Reassignment (or rep's calendar swapped) → delete + recreate.
      await deleteGcalEvent(link.calendar_id, link.google_calendar_event_id)
      const created = await createGcalEvent(rep.trunk_show_calendar_id, payload)
      await sb.from('trunk_show_gcal_event_links').upsert({
        trunk_show_id: show.id,
        rep_user_id: rep.id,
        calendar_id: rep.trunk_show_calendar_id,
        google_calendar_event_id: created.id,
        updated_at: new Date().toISOString(),
      })
      await markDone(row.id, 'reassigned')
      return { rowId: row.id, outcome: 'reassigned' }
    }

    // Same rep + same calendar → patch in place.
    await patchGcalEvent(link.calendar_id, link.google_calendar_event_id, payload)
    await sb.from('trunk_show_gcal_event_links')
      .update({ updated_at: new Date().toISOString() })
      .eq('trunk_show_id', show.id)
    await markDone(row.id, 'updated')
    return { rowId: row.id, outcome: 'updated' }

  } catch (e: any) {
    const msg = e?.message || 'unknown'
    await markFailureOrRetry(row.id, row.attempts || 0, msg)
    return { rowId: row.id, outcome: 'retry_or_failed', error: msg }
  }
}
