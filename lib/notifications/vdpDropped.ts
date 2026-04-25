// Detector for the "VDP dropped" alert. Called from /q/[code]/route.ts
// after a scan is logged. If the scan is the second one for this QR
// within an active event's campaign window, enqueues notifications to
// every superadmin (idempotent — at most one alert batch per
// (event, channel_source)).
//
// Fire-and-forget: callers should `void` this so the redirect isn't
// blocked.

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { enqueueNotification } from './enqueue'

const CAMPAIGN_WINDOW_DAYS = 28

function admin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

interface QrLite {
  id: string
  type: string
  store_id: string | null
  lead_source: string | null
}

export async function maybeFireVdpDropped(qr: QrLite): Promise<void> {
  // Only fires for channel QRs (VDP, Postcard, etc). Custom / Employee /
  // Group don't have a "campaign drop" semantics.
  if (qr.type !== 'channel' || !qr.lead_source || !qr.store_id) return

  const sb = admin()

  // Find the most relevant active event for this store: today must be
  // inside (start_date - 28d, start_date + ~3d). Pick the soonest by
  // start_date.
  const today = new Date()
  const todayIso = today.toISOString().slice(0, 10)
  const lookForwardIso = new Date(today.getTime() + CAMPAIGN_WINDOW_DAYS * 86400000).toISOString().slice(0, 10)
  const lookBackIso = new Date(today.getTime() - 4 * 86400000).toISOString().slice(0, 10)

  const { data: events } = await sb.from('events')
    .select('id, store_id, start_date, brand')
    .eq('store_id', qr.store_id)
    .gte('start_date', lookBackIso)
    .lte('start_date', lookForwardIso)
    .order('start_date', { ascending: true })
    .limit(5)

  if (!events || events.length === 0) return

  // Closest by start_date (smallest abs diff vs today).
  const todayMs = new Date(todayIso + 'T00:00:00Z').getTime()
  const event = events
    .map((e: any) => ({ e, d: Math.abs(new Date(e.start_date + 'T00:00:00Z').getTime() - todayMs) }))
    .sort((a, b) => a.d - b.d)[0].e

  // Compute campaign window for this event and count scans for this QR
  // within it. (Includes the scan we just logged.)
  const startMs = new Date(event.start_date + 'T00:00:00Z').getTime()
  const windowStart = new Date(startMs - CAMPAIGN_WINDOW_DAYS * 86400000).toISOString()
  // End-of-event approximated as start_date + 2d 23:59:59 (typical 3-day event).
  const windowEnd = new Date(startMs + 2 * 86400000 + 86399000).toISOString()

  const { count } = await sb.from('qr_scans')
    .select('id', { count: 'exact', head: true })
    .eq('qr_code_id', qr.id)
    .gte('scanned_at', windowStart)
    .lte('scanned_at', windowEnd)

  if ((count ?? 0) !== 2) return

  // Idempotency: any prior vdp_dropped row for this event + channel_source?
  const { data: existing } = await sb.from('scheduled_notifications')
    .select('id')
    .eq('trigger_type', 'vdp_dropped')
    .eq('related_event_id', event.id)
    .filter('merge_data->>channel_source', 'eq', qr.lead_source)
    .limit(1)
    .maybeSingle()

  if (existing) return

  // Pull every superadmin user; enqueue one row per. enqueueNotification
  // honors the (recipient_buyer_id, trigger_type, related_event_id) unique
  // index — superadmins are independent recipients so each row is unique.
  const { data: superadmins } = await sb.from('users')
    .select('id')
    .eq('role', 'superadmin')
    .eq('active', true)

  if (!superadmins || superadmins.length === 0) return

  const brand = (event.brand === 'liberty' ? 'liberty' : 'beb') as 'beb' | 'liberty'
  const firstScanAt = new Date().toISOString()

  await Promise.all(superadmins.map(async (u: any) => {
    try {
      await enqueueNotification({
        brand,
        trigger_type: 'vdp_dropped',
        buyer_id: u.id,
        event_id: event.id,
        extraMergeVars: {
          channel_source: qr.lead_source!,
          first_scan_at: firstScanAt,
        },
      })
    } catch (e) {
      console.error('[vdp_dropped] enqueue failed for', u.id, e)
    }
  }))
}
