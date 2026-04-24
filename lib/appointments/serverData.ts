// Server-only data fetching for the public /book/[slug] page.
// Uses the Supabase service-role key to bypass RLS — only ever import from
// Server Components or route handlers, never from a client component.

import { createClient } from '@supabase/supabase-js'
import type {
  BookingPayload,
  BookingStore,
  BookingConfig,
  BookingEvent,
  EventBookingOverride,
  AppointmentLite,
  SlotBlockLite,
} from './types'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Fetch the store row by slug, branding-only. Used by the booking page to
 * render a friendly "no upcoming events" empty state when the store exists
 * but isn't currently bookable, instead of a hard 404.
 */
export async function getStoreBranding(slug: string): Promise<BookingStore | null> {
  const sb = admin()
  const { data } = await sb
    .from('stores')
    .select('id, name, slug, store_image_url, color_primary, color_secondary, owner_phone, owner_email')
    .eq('slug', slug)
    .maybeSingle()
  return data ?? null
}

/**
 * Fetch everything the booking page needs for one store, by slug.
 * Returns null if the store doesn't exist or has no upcoming events.
 */
export async function getBookingPayload(slug: string): Promise<BookingPayload | null> {
  const sb = admin()

  // 1. Store row
  const { data: storeRow, error: storeErr } = await sb
    .from('stores')
    .select('id, name, slug, store_image_url, color_primary, color_secondary, owner_phone, owner_email')
    .eq('slug', slug)
    .maybeSingle()

  if (storeErr || !storeRow) return null

  const store: BookingStore = storeRow

  // 2. booking_config (per-store)
  const { data: configRow } = await sb
    .from('booking_config')
    .select('store_id, slot_interval_minutes, max_concurrent_slots, day1_start, day1_end, day2_start, day2_end, day3_start, day3_end, items_options, hear_about_options')
    .eq('store_id', store.id)
    .maybeSingle()

  if (!configRow) return null

  const config: BookingConfig = {
    ...configRow,
    items_options: Array.isArray(configRow.items_options) ? configRow.items_options : [],
    hear_about_options: Array.isArray(configRow.hear_about_options) ? configRow.hear_about_options : [],
  }

  // 3. Upcoming events for this store, with their day rows.
  const today = todayIso()
  const { data: eventRows } = await sb
    .from('events')
    .select('id, store_id, start_date, brand, days:event_days(id, day_number)')
    .eq('store_id', store.id)
    .gte('start_date', today)
    .order('start_date', { ascending: true })

  const events: BookingEvent[] = (eventRows ?? []).map(e => {
    const populatedDays = (e.days ?? []).sort((a: any, b: any) => a.day_number - b.day_number)
    // If no event_days rows exist yet (event was just created and the daily
    // entry rows haven't been seeded), assume the standard 1-3 day shape.
    // BookingClient still filters out days that have no hours in booking_config,
    // so only the days the store actually opens will show up.
    const days = populatedDays.length > 0
      ? populatedDays
      : [
          { id: `${e.id}-d1`, day_number: 1 },
          { id: `${e.id}-d2`, day_number: 2 },
          { id: `${e.id}-d3`, day_number: 3 },
        ]
    return {
      id: e.id,
      store_id: e.store_id,
      start_date: e.start_date,
      brand: e.brand,
      days,
    }
  })

  if (events.length === 0) return null

  const eventIds = events.map(e => e.id)

  // 4. event_booking_overrides for these events (currently we only use the soonest)
  const soonestEventId = events[0].id
  const { data: overrideRow } = await sb
    .from('event_booking_overrides')
    .select('event_id, max_concurrent_slots, day1_start, day1_end, day2_start, day2_end, day3_start, day3_end')
    .eq('event_id', soonestEventId)
    .maybeSingle()

  const override: EventBookingOverride | null = overrideRow ?? null

  // 5. Confirmed appointments + slot blocks for all upcoming events.
  const [{ data: bookingRows }, { data: blockRows }] = await Promise.all([
    sb.from('appointments')
      .select('appointment_date, appointment_time, status')
      .in('event_id', eventIds)
      .eq('status', 'confirmed'),
    sb.from('slot_blocks')
      .select('block_date, block_time')
      .in('event_id', eventIds),
  ])

  const bookings: AppointmentLite[] = bookingRows ?? []
  const blocks: SlotBlockLite[] = blockRows ?? []

  return { store, config, events, override, bookings, blocks }
}
