// Server-side enqueue / cancel / re-enqueue helpers for the delayed
// notification system. All callers (API routes, cron, future DB
// triggers) go through these — they own the rules around:
//   - finding the right template for (brand, trigger_type)
//   - resolving recipient + channels + delay
//   - snapshotting merge data at enqueue time
//   - keeping the in-flight idempotency invariant honest
//
// Uses the Supabase service-role client because RLS scopes writes to
// scheduled_notifications to superadmins only.

import { createClient } from '@supabase/supabase-js'
import { TRIGGER_REGISTRY, type TriggerType, type Channel } from './triggers'
import { buildMergeVars, type MergeVarsContext } from './mergeVars'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

function portalUrl(): string {
  return (
    process.env.NEXT_PUBLIC_PORTAL_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    'https://beb-portal-v2.vercel.app'
  )
}

interface EnqueueArgs {
  brand: 'beb' | 'liberty'
  trigger_type: TriggerType
  buyer_id: string
  event_id: string
}

export interface EnqueueResult {
  ok: boolean
  enqueued: boolean
  reason?: string
  row_id?: string
}

/**
 * Look up the template for (brand, trigger_type), gather the live
 * data needed for merge vars, and insert a scheduled_notifications
 * row scheduled for now() + template.delay_minutes.
 *
 * No-ops gracefully when:
 *   - The trigger type is a scaffold (implemented=false)
 *   - No template row exists for (brand, trigger_type)
 *   - The template is disabled
 *   - An in-flight row already exists for (buyer, trigger, event)
 *     — the partial unique index would reject the insert anyway
 */
export async function enqueueNotification(args: EnqueueArgs): Promise<EnqueueResult> {
  const def = TRIGGER_REGISTRY[args.trigger_type]
  if (!def) return { ok: false, enqueued: false, reason: 'unknown_trigger' }
  if (!def.implemented) return { ok: true, enqueued: false, reason: 'trigger_scaffold' }

  const sb = admin()

  const [tplRes, buyerRes, eventRes] = await Promise.all([
    sb.from('notification_templates')
      .select('id, enabled, channels, delay_minutes')
      .eq('brand', args.brand)
      .eq('trigger_type', args.trigger_type)
      .maybeSingle(),
    sb.from('users')
      .select('id, name, email, phone')
      .eq('id', args.buyer_id)
      .maybeSingle(),
    sb.from('events')
      .select('id, store_id, store_name, start_date, workers, brand')
      .eq('id', args.event_id)
      .maybeSingle(),
  ])

  const tpl = tplRes.data as any
  if (!tpl) return { ok: true, enqueued: false, reason: 'no_template' }
  if (!tpl.enabled) return { ok: true, enqueued: false, reason: 'template_disabled' }
  const channels: Channel[] = (tpl.channels || []).filter((c: any) => c === 'email' || c === 'sms')
  if (channels.length === 0) return { ok: true, enqueued: false, reason: 'no_channels' }

  const buyer = buyerRes.data as any
  if (!buyer) return { ok: false, enqueued: false, reason: 'buyer_not_found' }

  const event = eventRes.data as any
  if (!event) return { ok: false, enqueued: false, reason: 'event_not_found' }

  // Resolve store (timezone fallback) — events.store_id → stores
  const storeRes = await sb.from('stores')
    .select('id, name, city, address, timezone')
    .eq('id', event.store_id)
    .maybeSingle()
  const store = (storeRes.data as any) || { id: event.store_id, name: event.store_name }

  const others = ((event.workers || []) as { id: string; name: string }[])
    .filter(w => w.id !== buyer.id)

  const ctx: MergeVarsContext = {
    buyer: { id: buyer.id, name: buyer.name, email: buyer.email, phone: buyer.phone },
    event: {
      id: event.id,
      name: `${event.store_name}`,
      start_date: event.start_date,
      city: store.city,
      address: store.address,
      travel_share_url: `${portalUrl()}/?event=${event.id}&nav=travel`,
    },
    store: { id: store.id, name: store.name, timezone: store.timezone },
    brand: args.brand,
    otherBuyers: others,
    portalUrl: portalUrl(),
  }
  const mergeData = buildMergeVars(ctx)

  // Cap channels to ones the buyer can actually receive
  const usableChannels: Channel[] = channels.filter(c => {
    if (c === 'email') return !!buyer.email && /@/.test(buyer.email)
    if (c === 'sms') return !!buyer.phone && buyer.phone.replace(/\D/g, '').length >= 10
    return false
  })
  if (usableChannels.length === 0) {
    return { ok: true, enqueued: false, reason: 'no_usable_channels' }
  }

  const delayMs = (tpl.delay_minutes ?? def.defaultDelayMinutes) * 60 * 1000
  const scheduledFor = new Date(Date.now() + delayMs).toISOString()

  const insert = await sb.from('scheduled_notifications').insert({
    brand: args.brand,
    trigger_type: args.trigger_type,
    template_id: tpl.id,
    recipient_buyer_id: buyer.id,
    recipient_email: buyer.email,
    recipient_phone: buyer.phone,
    recipient_timezone: store.timezone || 'America/New_York',
    channels: usableChannels,
    merge_data: mergeData,
    scheduled_for: scheduledFor,
    status: 'pending',
    email_status: usableChannels.includes('email') ? 'pending' : null,
    sms_status: usableChannels.includes('sms') ? 'pending' : null,
    related_event_id: event.id,
  }).select('id').maybeSingle()

  if (insert.error) {
    // 23505 = unique violation, our in-flight idempotency index. That's
    // a benign race — a notification is already queued for this trio.
    if ((insert.error as any).code === '23505') {
      return { ok: true, enqueued: false, reason: 'already_in_flight' }
    }
    return { ok: false, enqueued: false, reason: insert.error.message }
  }

  return { ok: true, enqueued: true, row_id: insert.data?.id }
}

interface CancelArgs {
  buyer_id: string
  trigger_type: TriggerType
  event_id: string
  reason: string
}

/**
 * Cancel any pending/held notification for this (buyer, trigger, event).
 * Safe to call when nothing is queued — it's a no-op then.
 */
export async function cancelPendingNotification(args: CancelArgs): Promise<{ cancelled: number }> {
  const sb = admin()
  const { data, error } = await sb.from('scheduled_notifications')
    .update({
      status: 'cancelled',
      cancelled_reason: args.reason,
      updated_at: new Date().toISOString(),
    })
    .eq('recipient_buyer_id', args.buyer_id)
    .eq('trigger_type', args.trigger_type)
    .eq('related_event_id', args.event_id)
    .in('status', ['pending', 'held'])
    .select('id')

  if (error) throw new Error(`cancelPendingNotification: ${error.message}`)
  return { cancelled: (data || []).length }
}

/**
 * Cancel any pending notification for this trio and immediately enqueue
 * a fresh one. Used when a buyer's contact info / event reassignment
 * changes during the delay window — the timer resets and the next
 * snapshot picks up the new data.
 */
export async function cancelAndReenqueue(args: EnqueueArgs & { reason: string }): Promise<EnqueueResult> {
  await cancelPendingNotification({
    buyer_id: args.buyer_id,
    trigger_type: args.trigger_type,
    event_id: args.event_id,
    reason: args.reason,
  })
  return enqueueNotification(args)
}
