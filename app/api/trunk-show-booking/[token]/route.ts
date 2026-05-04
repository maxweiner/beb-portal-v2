// Public trunk-show appointment booking API. Token-gated; service
// role bypasses RLS for the anonymous caller. Mirrors the trade-
// show counterpart but captures customer first/last + the store
// salesperson's name (for spiff tracking in Phase 13).

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

async function resolveToken(token: string) {
  const sb = admin()
  const { data, error } = await sb
    .from('trunk_show_booking_tokens')
    .select('id, trunk_show_id, expires_at, revoked_at, salesperson_name')
    .eq('token', token).maybeSingle()
  if (error || !data) return null
  if (data.revoked_at) return null
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null
  return data
}

export async function GET(req: Request, { params }: { params: { token: string } }) {
  const t = await resolveToken(params.token)
  if (!t) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404 })
  const sb = admin()

  const { data: show } = await sb.from('trunk_shows')
    .select('id, store_id, start_date, end_date')
    .eq('id', t.trunk_show_id).is('deleted_at', null).maybeSingle()
  if (!show) return NextResponse.json({ error: 'Show not found' }, { status: 404 })

  const { data: store } = await sb.from('stores')
    .select('name, city, state, address, color_primary, color_secondary, store_image_url')
    .eq('id', show.store_id).maybeSingle()

  // Slots are pure time blocks now. A slot is "available to this
  // token" iff no booking exists for (slot, token). Bookings via
  // OTHER tokens don't block this customer — that's the per-rep
  // capacity model.
  const { data: slots } = await sb.from('trunk_show_appointment_slots')
    .select('id, slot_start, slot_end')
    .eq('trunk_show_id', t.trunk_show_id)
    .order('slot_start', { ascending: true })

  const { data: bookings } = await sb.from('trunk_show_slot_bookings')
    .select('slot_id')
    .eq('booking_token_id', t.id)
    .eq('status', 'booked')
  const blockedSlotIds = new Set((bookings || []).map(b => b.slot_id))

  const available = (slots || []).filter(s => !blockedSlotIds.has(s.id))

  await sb.from('trunk_show_booking_tokens')
    .update({ last_used_at: new Date().toISOString() }).eq('id', t.id)

  return NextResponse.json({
    show: { ...show, store: store || null },
    slots: available.map(s => ({ id: s.id, slot_start: s.slot_start, slot_end: s.slot_end })),
    // When the token has a salesperson tagged, the booking page can
    // display that and skip prompting for it.
    token_salesperson_name: t.salesperson_name || null,
  })
}

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const t = await resolveToken(params.token)
  if (!t) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404 })

  let body: any
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { slotId, first_name, last_name, email, phone, salesperson, notes } = body || {}
  if (!slotId || !first_name?.trim()) {
    return NextResponse.json({ error: 'Missing slot or first name' }, { status: 400 })
  }

  const sb = admin()
  const { data: slot } = await sb.from('trunk_show_appointment_slots')
    .select('id, trunk_show_id').eq('id', slotId).maybeSingle()
  if (!slot || slot.trunk_show_id !== t.trunk_show_id) {
    return NextResponse.json({ error: 'Slot not found' }, { status: 404 })
  }

  // Per-rep capacity: this token can have at most one booking per
  // slot. The DB has a unique partial index on (slot_id,
  // booking_token_id) so a race-condition double-insert returns 23505.
  const { data: existing } = await sb.from('trunk_show_slot_bookings')
    .select('id').eq('slot_id', slot.id).eq('booking_token_id', t.id)
    .eq('status', 'booked').maybeSingle()
  if (existing) {
    return NextResponse.json({ error: 'This time is already booked through this link — pick another.' }, { status: 409 })
  }

  const norm = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null)
  // Salesperson resolution: customer-typed value wins, otherwise
  // fall back to the salesperson tagged on the token.
  const resolvedSalesperson = norm(salesperson) || norm(t.salesperson_name as any)
  const { error: upErr } = await sb.from('trunk_show_slot_bookings').insert({
    slot_id:                slot.id,
    booking_token_id:       t.id,
    customer_first_name:    first_name.trim(),
    customer_last_name:     norm(last_name),
    customer_email:         norm(email),
    customer_phone:         norm(phone),
    store_salesperson_name: resolvedSalesperson,
    notes:                  norm(notes),
  })
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  await sb.from('trunk_show_booking_tokens')
    .update({ last_used_at: new Date().toISOString() }).eq('id', t.id)

  return NextResponse.json({ ok: true })
}
