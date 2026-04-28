// Shared box-polling logic used by both the Vercel cron (`/api/cron/poll-tracking`)
// and the per-box "Refresh now" endpoint. Keeping it in one place means the
// auto-advance rule (carrier says delivered → mark box received) lives in
// exactly one spot.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getFedexStatus } from './carriers/fedex'
import type { CarrierStatusResult } from './carriers/types'

export interface PollableBox {
  id: string
  tracking_number: string | null
  carrier: string | null
  status: string
}

export interface PollOutcome {
  boxId: string
  ok: boolean
  status?: string
  carrierStatus?: string
  autoReceived?: boolean
  error?: string
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
    case 'fedex':
      return await getFedexStatus(box.tracking_number)
    // case 'ups': return await getUpsStatus(box.tracking_number)  // PR 6
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

  let autoReceived = false
  let nextBoxStatus = box.status
  if (result.status === 'delivered' && box.status !== 'received' && box.status !== 'cancelled') {
    update.status = 'received'
    update.received_at = result.deliveredAt ?? nowIso
    // received_by left NULL on purpose — distinguishes carrier auto-mark
    // from a human pressing "Mark received".
    autoReceived = true
    nextBoxStatus = 'received'
  }

  const { error } = await sb.from('event_shipment_boxes').update(update).eq('id', box.id)
  if (error) {
    return { boxId: box.id, ok: false, error: error.message }
  }
  return {
    boxId: box.id,
    ok: true,
    status: nextBoxStatus,
    carrierStatus: result.status,
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
    .select('id, tracking_number, carrier, status, last_polled_at')
    .not('tracking_number', 'is', null)
    .not('carrier', 'is', null)
    .not('status', 'in', '(received,cancelled)')
    .or(`last_polled_at.is.null,last_polled_at.lt.${cutoff}`)
    .order('last_polled_at', { ascending: true, nullsFirst: true })
    .limit(batchSize)
  if (error) throw new Error(error.message)
  return (data ?? []) as PollableBox[]
}
