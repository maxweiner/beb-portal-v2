// Per-row dispatcher for trade_show_gcal_sync_queue. Called by the
// every-minute Vercel cron worker after claim_due_trade_show_syncs
// has flipped the row to 'processing'.
//
// Architecture mirrors trunkShowDispatcher.ts but writes to a SINGLE
// org-wide calendar (from trade_show_gcal_settings) instead of a
// per-rep calendar. Spec 2026-05-16: trade shows are visible to
// the whole company, no per-rep splitting.
//
// Two action types:
//
//   'sync'   → look up the trade show + existing link and reconcile
//              (create / update / no-op / soft-deleted-clean-up).
//   'delete' → use the snapshot to remove the Google event without
//              needing the trade_show row to still exist.
//
// Soft-deleted shows (deleted_at IS NOT NULL) are treated as
// delete: remove from Google, drop the link row so a re-activation
// re-creates the event cleanly.
//
// If org-wide calendar isn't configured yet (enabled=false or
// calendar_id is NULL), every sync row is no-op'd (marked done with
// nothing pushed). That lets the trigger fire freely before Max
// pastes the calendar ID — no queue backup, no error storms.
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
  trade_show_id: string | null
  action: 'sync' | 'delete'
  snapshot: any
  attempts: number
  status: string
}

interface TradeShowGcalSettings {
  enabled: boolean
  calendar_id: string | null
}

/** Cached per-tick. Settings rarely change — refetched once per
 *  cron invocation by the route handler and passed in. */
export async function fetchTradeShowGcalSettings(): Promise<TradeShowGcalSettings> {
  const sb = admin()
  const { data } = await sb.from('trade_show_gcal_settings')
    .select('enabled, calendar_id').eq('id', 1).maybeSingle()
  return {
    enabled: !!(data as any)?.enabled,
    calendar_id: (data as any)?.calendar_id || null,
  }
}

/**
 * Build the Google event body from a trade-show row. Google's
 * all-day end is exclusive — we add a day to end_date so a 3-day
 * show occupies the right number of cells.
 */
function buildEventInput(show: any): GcalEventInput {
  const titleBits: string[] = []
  if (show.name) titleBits.push(show.name)
  if (show.booth_number) titleBits.push(`Booth ${show.booth_number}`)
  const summary = titleBits.join(' · ') || 'Trade Show'

  const locParts = [show.venue_name, show.venue_address, show.venue_city, show.venue_state].filter(Boolean)

  const descLines: string[] = []
  if (show.organizing_body) descLines.push(`Organizer: ${show.organizing_body}`)
  if (show.venue_name) descLines.push(`Venue: ${show.venue_name}`)
  if (show.booth_number) descLines.push(`Booth: ${show.booth_number}`)
  if (show.show_website_url) descLines.push(`Website: ${show.show_website_url}`)
  if (show.notes) descLines.push('', show.notes)
  descLines.push('', `Open in portal: ${portalUrl()}/?nav=trade-shows`)

  const endExclusive = (() => {
    const d = new Date(show.end_date + 'T12:00:00')
    d.setDate(d.getDate() + 1)
    return d.toISOString().slice(0, 10)
  })()

  return {
    summary,
    description: descLines.join('\n'),
    location: locParts.join(', '),
    startDate: show.start_date,
    endDate: endExclusive,
    source: { title: 'Open in BEB Portal', url: `${portalUrl()}/?nav=trade-shows` },
  }
}

/**
 * Process a single queue row. Mutates the row to 'done' or 'failed'
 * (or back to 'pending' for retry). Throws nothing — the cron route
 * doesn't need to handle errors per row.
 */
export async function dispatchOneTradeShowSync(row: QueueRow): Promise<void> {
  const sb = admin()
  try {
    const settings = await fetchTradeShowGcalSettings()

    // Org-wide calendar not configured yet → no-op cleanly so the
    // queue drains. Trigger will keep enqueuing; we'll start
    // pushing the moment Settings → Trade Show GCal gets a
    // calendar_id and is enabled.
    if (!settings.enabled || !settings.calendar_id) {
      await sb.from('trade_show_gcal_sync_queue').update({
        status: 'done',
        last_error: 'gcal_not_configured',
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', row.id)
      return
    }

    if (row.action === 'delete') {
      const snap = row.snapshot || {}
      const calId = String(snap.calendar_id || '')
      const eventId = String(snap.google_event_id || '')
      if (calId && eventId) {
        await deleteGcalEvent(calId, eventId)
      }
      if (row.trade_show_id) {
        await sb.from('trade_show_gcal_event_links').delete().eq('trade_show_id', row.trade_show_id)
      }
      await markDone(sb, row.id)
      return
    }

    // 'sync' — look up the show + existing link.
    if (!row.trade_show_id) {
      await markDone(sb, row.id, 'missing_trade_show_id')
      return
    }

    const { data: show } = await sb.from('trade_shows')
      .select('id, name, start_date, end_date, venue_name, venue_address, venue_city, venue_state, booth_number, notes, organizing_body, show_website_url, deleted_at')
      .eq('id', row.trade_show_id)
      .maybeSingle()
    if (!show) {
      await markDone(sb, row.id, 'show_not_found')
      return
    }

    const { data: link } = await sb.from('trade_show_gcal_event_links')
      .select('calendar_id, google_calendar_event_id')
      .eq('trade_show_id', row.trade_show_id)
      .maybeSingle()

    // Soft-deleted → remove from Google + drop link.
    if ((show as any).deleted_at) {
      if (link) {
        try {
          await deleteGcalEvent((link as any).calendar_id, (link as any).google_calendar_event_id)
        } catch (e) {
          // Best-effort — if the Google event was already removed,
          // proceed with link cleanup.
          console.warn('[tradeShowDispatcher] delete-on-soft-delete failed', e)
        }
        await sb.from('trade_show_gcal_event_links').delete().eq('trade_show_id', row.trade_show_id)
      }
      await markDone(sb, row.id)
      return
    }

    const body = buildEventInput(show)

    // Existing link on the SAME calendar → patch in place.
    // Existing link on a DIFFERENT calendar (Max swapped the
    // calendar ID) → delete old + create new.
    if (link && (link as any).calendar_id === settings.calendar_id) {
      await patchGcalEvent(settings.calendar_id, (link as any).google_calendar_event_id, body)
      await sb.from('trade_show_gcal_event_links').update({ updated_at: new Date().toISOString() })
        .eq('trade_show_id', row.trade_show_id)
    } else {
      if (link) {
        try {
          await deleteGcalEvent((link as any).calendar_id, (link as any).google_calendar_event_id)
        } catch (e) {
          console.warn('[tradeShowDispatcher] delete-on-calendar-swap failed', e)
        }
      }
      const created = await createGcalEvent(settings.calendar_id, body)
      await sb.from('trade_show_gcal_event_links').upsert({
        trade_show_id: row.trade_show_id,
        calendar_id: settings.calendar_id,
        google_calendar_event_id: created.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'trade_show_id' })
    }

    await markDone(sb, row.id)
  } catch (e: any) {
    await markFailedOrRetry(sb, row, e?.message || 'unknown')
  }
}

async function markDone(sb: SupabaseClient, id: string, reason?: string): Promise<void> {
  await sb.from('trade_show_gcal_sync_queue').update({
    status: 'done',
    last_error: reason ?? null,
    processed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', id)
}

async function markFailedOrRetry(sb: SupabaseClient, row: QueueRow, error: string): Promise<void> {
  if (row.attempts >= MAX_ATTEMPTS) {
    await sb.from('trade_show_gcal_sync_queue').update({
      status: 'failed',
      last_error: error.slice(0, 500),
      processed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', row.id)
    return
  }
  // Re-queue with exponential backoff. attempts has already been
  // bumped by the claim RPC.
  const minutes = RETRY_BACKOFF_MINUTES[row.attempts - 1] ?? RETRY_BACKOFF_MINUTES[RETRY_BACKOFF_MINUTES.length - 1]
  const nextRun = new Date(Date.now() + minutes * 60_000).toISOString()
  await sb.from('trade_show_gcal_sync_queue').update({
    status: 'pending',
    last_error: error.slice(0, 500),
    scheduled_for: nextRun,
    updated_at: new Date().toISOString(),
  }).eq('id', row.id)
}
