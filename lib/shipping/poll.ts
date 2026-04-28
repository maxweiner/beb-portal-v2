// Shared box-polling logic used by both the Vercel cron (`/api/cron/poll-tracking`)
// and the per-box "Refresh now" endpoint. Keeping it in one place means the
// auto-advance rule (carrier says delivered → mark box received) lives in
// exactly one spot.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getFedexStatus } from './carriers/fedex'
import { getUpsStatus } from './carriers/ups'
import type { CarrierStatusResult } from './carriers/types'

export interface PollableBox {
  id: string
  tracking_number: string | null
  carrier: string | null
  status: string
  labels_sent_at: string | null
  shipped_at: string | null
  received_at: string | null
}

export interface PollOutcome {
  boxId: string
  ok: boolean
  status?: string
  previousStatus?: string
  carrierStatus?: string
  autoAdvanced?: boolean
  autoReceived?: boolean
  error?: string
}

// Carrier event → minimum manual-workflow status the box should be at.
// Only used to ADVANCE; the poller never downgrades. unknown / exception
// / returned leave the manual status alone (preserve human's choice).
const MANUAL_RANK: Record<string, number> = {
  pending: 0,
  labels_sent: 1,
  shipped: 2,
  received: 3,
}

function carrierTargetManual(carrierStatus: string): string | null {
  switch (carrierStatus) {
    case 'label_created':    return 'labels_sent'
    case 'in_transit':
    case 'out_for_delivery': return 'shipped'
    case 'delivered':        return 'received'
    default: return null
  }
}

function admin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

async function fetchCarrierStatus(box: PollableBox): Promise<CarrierStatusResult> {
  if (!box.tracking_number) throw new Error('no tracking number')
  switch (box.carrier) {
    case 'fedex': return await getFedexStatus(box.tracking_number)
    case 'ups':   return await getUpsStatus(box.tracking_number)
    default:
      throw new Error(`carrier "${box.carrier ?? 'unknown'}" not supported yet`)
  }
}

/**
 * Poll one box, persist normalized fields, and auto-advance to 'received'
 * when the carrier reports delivered. Always stamps last_polled_at.
 */
export async function pollOneBox(box: PollableBox, sb: SupabaseClient = admin()): Promise<PollOutcome> {
  const nowIso = new Date().toISOString()
  let result: CarrierStatusResult
  try {
    result = await fetchCarrierStatus(box)
  } catch (err: any) {
    await sb.from('event_shipment_boxes')
      .update({
        last_polled_at: nowIso,
        carrier_poll_error: (err?.message ?? 'unknown error').slice(0, 500),
      })
      .eq('id', box.id)
    return { boxId: box.id, ok: false, error: err?.message ?? 'unknown error' }
  }

  const update: Record<string, any> = {
    last_polled_at: nowIso,
    carrier_status: result.status,
    carrier_status_detail: result.statusDetail,
    carrier_last_event: result.lastEvent,
    carrier_event_at: result.eventAt,
    carrier_eta: result.eta,
    carrier_poll_error: null,
  }

  // Auto-advance the manual workflow status to track what the carrier
  // says, so the action button isn't stuck at "Mark labels sent" while
  // FedEx is already showing the package in transit. Only moves forward;
  // skipped steps get their _at timestamp backfilled (with _by left NULL
  // so we can tell carrier-marked from human-marked).
  let autoAdvanced = false
  let autoReceived = false
  let nextBoxStatus = box.status
  const target = carrierTargetManual(result.status)
  const currentRank = MANUAL_RANK[box.status]
  const targetRank = target != null ? MANUAL_RANK[target] : -1
  if (
    target != null &&
    box.status !== 'cancelled' &&
    currentRank != null &&
    targetRank > currentRank
  ) {
    update.status = target
    nextBoxStatus = target
    autoAdvanced = true
    if (target === 'received') autoReceived = true

    const stamp = result.eventAt ?? nowIso
    if (targetRank >= MANUAL_RANK.labels_sent && !box.labels_sent_at) {
      update.labels_sent_at = stamp
    }
    if (targetRank >= MANUAL_RANK.shipped && !box.shipped_at) {
      update.shipped_at = stamp
    }
    if (targetRank >= MANUAL_RANK.received && !box.received_at) {
      update.received_at = result.deliveredAt ?? stamp
    }
  }

  const { error } = await sb.from('event_shipment_boxes').update(update).eq('id', box.id)
  if (error) {
    return { boxId: box.id, ok: false, error: error.message }
  }
  return {
    boxId: box.id,
    ok: true,
    status: nextBoxStatus,
    previousStatus: box.status,
    carrierStatus: result.status,
    autoAdvanced,
    autoReceived,
  }
}

/**
 * Pick the next batch of boxes due for a refresh, oldest-first. Skips boxes
 * polled more recently than `minIntervalMs` so manual refreshes don't get
 * trampled by the cron.
 */
export async function claimDueBoxes(
  sb: SupabaseClient,
  { batchSize, minIntervalMs }: { batchSize: number; minIntervalMs: number },
): Promise<PollableBox[]> {
  const cutoff = new Date(Date.now() - minIntervalMs).toISOString()
  const { data, error } = await sb
    .from('event_shipment_boxes')
    .select('id, tracking_number, carrier, status, labels_sent_at, shipped_at, received_at, last_polled_at')
    .not('tracking_number', 'is', null)
    .not('carrier', 'is', null)
    .not('status', 'in', '(received,cancelled)')
    .or(`last_polled_at.is.null,last_polled_at.lt.${cutoff}`)
    .order('last_polled_at', { ascending: true, nullsFirst: true })
    .limit(batchSize)
  if (error) throw new Error(error.message)
  return (data ?? []) as PollableBox[]
}
