// POST /api/appointments — public, no auth.
// Verifies slot availability and inserts a confirmed appointment row.
//
// Body: {
//   slug: string                  // store slug
//   event_id: string
//   appointment_date: 'YYYY-MM-DD'
//   appointment_time: 'HH:MM'
//   customer_name: string
//   customer_phone: string
//   customer_email: string
//   items_bringing: string[]
//   how_heard?: string | null
// }
//
// Returns: { ok: true, appointment_id, cancel_token } or { error } with
// 4xx / 5xx status.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { buildSlotsForDay, hoursForEventDay } from '@/lib/appointments/slots'
import { sendConfirmation } from '@/lib/appointments/notifications'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status })
}

export async function POST(req: Request) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return bad('Invalid JSON body')
  }

  const {
    slug,
    event_id,
    appointment_date,
    appointment_time,
    customer_name,
    customer_phone,
    customer_email,
    items_bringing,
    how_heard,
    // Optional fields used by the store-portal flow
    appointment_employee_id,
    is_walkin,
    booked_by,
    notes,
  } = body ?? {}

  if (!slug || !event_id || !appointment_date || !appointment_time) {
    return bad('Missing slug, event_id, appointment_date, or appointment_time')
  }
  if (!customer_name?.trim() || !customer_phone?.trim() || !customer_email?.trim()) {
    return bad('Missing customer name, phone, or email')
  }
  if (!Array.isArray(items_bringing) || items_bringing.length === 0) {
    return bad('Missing items_bringing')
  }

  const sb = admin()

  // Resolve store + brand from slug
  const { data: store, error: storeErr } = await sb
    .from('stores')
    .select('id, name, slug, brand, owner_phone, owner_email')
    .eq('slug', slug)
    .maybeSingle()
  if (storeErr || !store) return bad('Unknown store', 404)

  // Confirm event belongs to this store
  const { data: event, error: eventErr } = await sb
    .from('events')
    .select('id, store_id, start_date, days:event_days(id, day_number)')
    .eq('id', event_id)
    .maybeSingle()
  if (eventErr || !event) return bad('Unknown event', 404)
  if (event.store_id !== store.id) return bad('Event does not belong to this store', 400)

  // Determine which day_number this appointment is on (1, 2, or 3)
  const eventStart = new Date(event.start_date + 'T12:00:00')
  const apptDate = new Date(appointment_date + 'T12:00:00')
  const dayNumber = Math.round(
    (apptDate.getTime() - eventStart.getTime()) / (1000 * 60 * 60 * 24)
  ) + 1
  if (dayNumber < 1 || dayNumber > 3) {
    return bad('Appointment date is outside this event')
  }

  // Load store + override config to compute hours/capacity
  const [{ data: config }, { data: override }] = await Promise.all([
    sb.from('booking_config')
      .select('slot_interval_minutes, max_concurrent_slots, day1_start, day1_end, day2_start, day2_end, day3_start, day3_end')
      .eq('store_id', store.id)
      .maybeSingle(),
    sb.from('event_booking_overrides')
      .select('max_concurrent_slots, day1_start, day1_end, day2_start, day2_end, day3_start, day3_end')
      .eq('event_id', event.id)
      .maybeSingle(),
  ])
  if (!config) return bad('Store has no booking_config', 500)

  const hours = hoursForEventDay(dayNumber as 1 | 2 | 3, config, override)
  if (!hours) return bad('No hours configured for this day', 400)

  // Verify slot availability against current state
  const [{ data: existing }, { data: blocks }] = await Promise.all([
    sb.from('appointments')
      .select('appointment_date, appointment_time, status')
      .eq('event_id', event.id)
      .eq('appointment_date', appointment_date)
      .eq('status', 'confirmed'),
    sb.from('slot_blocks')
      .select('block_date, block_time')
      .eq('event_id', event.id)
      .eq('block_date', appointment_date),
  ])

  const slots = buildSlotsForDay({
    date: appointment_date,
    startTime: hours.start,
    endTime: hours.end,
    intervalMinutes: config.slot_interval_minutes,
    maxConcurrent: override?.max_concurrent_slots ?? config.max_concurrent_slots,
    bookings: existing ?? [],
    blocks: blocks ?? [],
  })

  const wantTime = appointment_time.length >= 5 ? appointment_time.slice(0, 5) : appointment_time
  const slot = slots.find(s => s.time === wantTime)
  if (!slot) return bad('Requested time is not a valid slot', 400)
  if (slot.isPast) return bad('That time is in the past', 400)
  if (slot.blocked) return bad('That slot is blocked', 409)
  if (slot.available <= 0) return bad('That slot is full', 409)

  // Insert the appointment. cancel_token defaults via the schema.
  const validBookedBy = booked_by === 'store' || booked_by === 'admin' ? booked_by : 'customer'

  const { data: inserted, error: insertErr } = await sb
    .from('appointments')
    .insert({
      event_id: event.id,
      store_id: store.id,
      brand: store.brand ?? 'beb',
      appointment_date,
      appointment_time: wantTime,
      customer_name: customer_name.trim(),
      customer_phone: customer_phone.trim(),
      customer_email: customer_email.trim(),
      items_bringing,
      how_heard: how_heard ?? null,
      booked_by: validBookedBy,
      appointment_employee_id: appointment_employee_id || null,
      is_walkin: !!is_walkin,
      notes: notes ?? null,
    })
    .select('id, cancel_token')
    .single()

  if (insertErr || !inserted) {
    console.error('appointments insert failed', insertErr)
    return bad('Could not create appointment', 500)
  }

  // Best-effort confirmation — never block the booking response on it.
  sendConfirmation({
    appt: {
      id: inserted.id,
      cancel_token: inserted.cancel_token,
      customer_name: customer_name.trim(),
      customer_phone: customer_phone.trim(),
      customer_email: customer_email.trim(),
      appointment_date,
      appointment_time: wantTime,
    },
    store: {
      name: store.name,
      slug: store.slug,
      owner_phone: store.owner_phone,
      owner_email: store.owner_email,
    },
  }).catch(err => console.error('sendConfirmation failed', err))

  return NextResponse.json({
    ok: true,
    appointment_id: inserted.id,
    cancel_token: inserted.cancel_token,
  })
}
