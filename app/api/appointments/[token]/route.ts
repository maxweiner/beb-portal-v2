// GET    /api/appointments/[token]  → fetch appointment for the manage page
// DELETE /api/appointments/[token]  → cancel (sets status='cancelled', sends notice)

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendCancellation, sendConfirmation } from '@/lib/appointments/notifications'
import { buildSlotsForDay, hoursForEventDay } from '@/lib/appointments/slots'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

async function loadAppt(sb: ReturnType<typeof admin>, token: string) {
  const { data: appt } = await sb
    .from('appointments')
    .select('id, cancel_token, status, appointment_date, appointment_time, customer_name, customer_phone, customer_email, items_bringing, how_heard, store_id, event_id')
    .eq('cancel_token', token)
    .maybeSingle()
  if (!appt) return { appt: null, store: null }

  const { data: store } = await sb
    .from('stores')
    .select('name, slug, owner_phone, owner_email, color_primary, color_secondary, store_image_url')
    .eq('id', appt.store_id)
    .maybeSingle()

  return { appt, store }
}

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const sb = admin()
  const { appt, store } = await loadAppt(sb, params.token)
  if (!appt) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ appointment: appt, store })
}

export async function PUT(req: Request, { params }: { params: { token: string } }) {
  const sb = admin()
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const {
    appointment_date,
    appointment_time,
    customer_name,
    customer_phone,
    customer_email,
    items_bringing,
    how_heard,
    appointment_employee_id,
    is_walkin,
    notes,
  } = body ?? {}
  if (!appointment_date || !appointment_time) {
    return NextResponse.json({ error: 'Missing appointment_date or appointment_time' }, { status: 400 })
  }

  const { data: appt } = await sb
    .from('appointments')
    .select('id, cancel_token, status, customer_name, customer_phone, customer_email, store_id, event_id')
    .eq('cancel_token', params.token)
    .maybeSingle()
  if (!appt) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (appt.status !== 'confirmed') {
    return NextResponse.json({ error: 'Only confirmed appointments can be rescheduled' }, { status: 400 })
  }

  const { data: event } = await sb
    .from('events')
    .select('id, store_id, start_date')
    .eq('id', appt.event_id)
    .maybeSingle()
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

  const eventStart = new Date(event.start_date + 'T12:00:00')
  const apptDate = new Date(appointment_date + 'T12:00:00')
  const dayNumber = Math.round(
    (apptDate.getTime() - eventStart.getTime()) / (1000 * 60 * 60 * 24)
  ) + 1
  if (dayNumber < 1 || dayNumber > 3) {
    return NextResponse.json({ error: 'Date is outside this event' }, { status: 400 })
  }

  const [{ data: config }, { data: override }] = await Promise.all([
    sb.from('booking_config')
      .select('slot_interval_minutes, max_concurrent_slots, day1_start, day1_end, day2_start, day2_end, day3_start, day3_end')
      .eq('store_id', appt.store_id)
      .maybeSingle(),
    sb.from('event_booking_overrides')
      .select('max_concurrent_slots, day1_start, day1_end, day2_start, day2_end, day3_start, day3_end')
      .eq('event_id', event.id)
      .maybeSingle(),
  ])
  if (!config) return NextResponse.json({ error: 'Store has no booking_config' }, { status: 500 })

  const hours = hoursForEventDay(dayNumber as 1 | 2 | 3, config, override)
  if (!hours) return NextResponse.json({ error: 'No hours configured for this day' }, { status: 400 })

  // Validate the requested slot, EXCLUDING this appointment from the existing-bookings count.
  const [{ data: existingBookings }, { data: blocks }] = await Promise.all([
    sb.from('appointments')
      .select('appointment_date, appointment_time, status')
      .eq('event_id', event.id)
      .eq('appointment_date', appointment_date)
      .eq('status', 'confirmed')
      .neq('id', appt.id),
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
    bookings: existingBookings ?? [],
    blocks: blocks ?? [],
  })

  const wantTime = appointment_time.length >= 5 ? appointment_time.slice(0, 5) : appointment_time
  const slot = slots.find(s => s.time === wantTime)
  if (!slot) return NextResponse.json({ error: 'Requested time is not a valid slot' }, { status: 400 })
  if (slot.isPast) return NextResponse.json({ error: 'That time is in the past' }, { status: 400 })
  if (slot.blocked) return NextResponse.json({ error: 'That slot is blocked' }, { status: 409 })
  if (slot.available <= 0) return NextResponse.json({ error: 'That slot is full' }, { status: 409 })

  // Build the update payload — only include keys that were sent. This lets
  // a callsite send just date/time (the legacy reschedule path) or every
  // editable field (the new edit modal).
  const updates: Record<string, any> = {
    appointment_date,
    appointment_time: wantTime,
  }
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k)
  if (has('customer_name'))  updates.customer_name  = String(customer_name || '').trim()
  if (has('customer_phone')) updates.customer_phone = String(customer_phone || '').trim()
  if (has('customer_email')) updates.customer_email = String(customer_email || '').trim()
  if (has('items_bringing') && Array.isArray(items_bringing)) updates.items_bringing = items_bringing
  if (has('how_heard')       && Array.isArray(how_heard))       updates.how_heard       = how_heard
  if (has('appointment_employee_id')) updates.appointment_employee_id = appointment_employee_id || null
  if (has('is_walkin'))  updates.is_walkin = !!is_walkin
  if (has('notes'))      updates.notes     = notes ?? null

  const { error: updErr } = await sb
    .from('appointments')
    .update(updates)
    .eq('id', appt.id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  // Detect whether anything notification-worthy actually changed
  const dateChanged = appointment_date !== (appt as any).appointment_date
  const timeChanged = wantTime !== ((appt as any).appointment_time || '').slice(0, 5)
  const phoneChanged = has('customer_phone') && updates.customer_phone !== (appt.customer_phone || '')
  const emailChanged = has('customer_email') && updates.customer_email !== (appt.customer_email || '')

  const { data: store } = await sb
    .from('stores')
    .select('name, slug, owner_phone, owner_email')
    .eq('id', appt.store_id)
    .maybeSingle()

  // Notification rules:
  //   - date or time changed → send the reschedule confirmation immediately
  //   - phone or email changed (without a date/time change) → enqueue a
  //     30-minute debounced "contact info updated" notification via the
  //     notification_queue table. The queue cron processes it.
  //   - only items / how_heard / employee / walkin / notes changed → no notification
  if (store && (dateChanged || timeChanged)) {
    sendConfirmation({
      appt: {
        id: appt.id,
        cancel_token: appt.cancel_token,
        customer_name: updates.customer_name ?? appt.customer_name,
        customer_phone: updates.customer_phone ?? appt.customer_phone,
        customer_email: updates.customer_email ?? appt.customer_email,
        appointment_date,
        appointment_time: wantTime,
      },
      store: {
        name: store.name, slug: store.slug,
        owner_phone: store.owner_phone, owner_email: store.owner_email,
      },
    }).catch(err => console.error('reschedule confirmation failed', err))
  } else if (store && (phoneChanged || emailChanged)) {
    // Debounced — upsert by (appointment_id, template_key). If a row already
    // exists for this appointment, push scheduled_for back to now + 30 min
    // and refresh the recipient. The cron picks it up after the window.
    const scheduledFor = new Date(Date.now() + 30 * 60 * 1000).toISOString()
    if (phoneChanged && updates.customer_phone) {
      await sb.from('notification_queue').upsert({
        appointment_id: appt.id,
        template_key: 'contact_info_updated_sms',
        channel: 'sms',
        recipient: updates.customer_phone,
        scheduled_for: scheduledFor,
        status: 'pending',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'appointment_id,template_key' })
    }
    if (emailChanged && updates.customer_email) {
      await sb.from('notification_queue').upsert({
        appointment_id: appt.id,
        template_key: 'contact_info_updated_email',
        channel: 'email',
        recipient: updates.customer_email,
        scheduled_for: scheduledFor,
        status: 'pending',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'appointment_id,template_key' })
    }
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, { params }: { params: { token: string } }) {
  const sb = admin()
  const { appt, store } = await loadAppt(sb, params.token)
  if (!appt) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (appt.status === 'cancelled') {
    return NextResponse.json({ ok: true, already: true })
  }

  const { error } = await sb
    .from('appointments')
    .update({ status: 'cancelled' })
    .eq('id', appt.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (store) {
    sendCancellation({
      appt: {
        id: appt.id,
        cancel_token: appt.cancel_token,
        customer_name: appt.customer_name,
        customer_phone: appt.customer_phone,
        customer_email: appt.customer_email,
        appointment_date: appt.appointment_date,
        appointment_time: appt.appointment_time,
      },
      store: {
        name: store.name,
        slug: store.slug,
        owner_phone: store.owner_phone,
        owner_email: store.owner_email,
      },
    }).catch(err => console.error('sendCancellation failed', err))
  }

  return NextResponse.json({ ok: true })
}
