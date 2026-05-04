// POST /api/trunk-show-slot-bookings/[id]/purchase
//
// Body: { purchased: boolean }
//
// Flips a trunk-show booking's `purchased` flag and creates / removes
// the corresponding row in trunk_show_spiffs. Service-role write
// lets sales reps trigger the spiff insert without holding admin
// RLS write privileges on trunk_show_spiffs.
//
// Replaces the older /api/trunk-show-slots/:slotId/purchase route
// — purchase + spiff are now per-booking (so two reps booking the
// same time slot each get their own spiff).

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const purchased = !!body?.purchased
  const sb = admin()

  const { data: booking, error: bErr } = await sb
    .from('trunk_show_slot_bookings')
    .select('id, slot_id, store_salesperson_name, purchased')
    .eq('id', params.id).maybeSingle()
  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 })
  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })

  const { data: slot } = await sb.from('trunk_show_appointment_slots')
    .select('trunk_show_id').eq('id', booking.slot_id).maybeSingle()
  if (!slot) return NextResponse.json({ error: 'Slot not found' }, { status: 404 })

  // Authorization: sales rep on this trunk show, OR admin / partner.
  const { data: show } = await sb.from('trunk_shows')
    .select('assigned_rep_id').eq('id', slot.trunk_show_id).maybeSingle()
  const isAdmin = me.role === 'admin' || me.role === 'superadmin' || me.is_partner
  const isAssignedRep = show?.assigned_rep_id === me.id
  if (!isAdmin && !isAssignedRep) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Update the booking.
  const { error: upErr } = await sb.from('trunk_show_slot_bookings').update({
    purchased,
    purchased_marked_by: purchased ? me.id : null,
    purchased_marked_at: purchased ? new Date().toISOString() : null,
  }).eq('id', booking.id)
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  if (purchased) {
    if (!booking.store_salesperson_name?.trim()) {
      return NextResponse.json({ ok: true, spiff: null, notice: 'Marked purchased, but no spiff was created — add the store salesperson on the booking first.' })
    }
    const { data: existing } = await sb.from('trunk_show_spiffs')
      .select('id').eq('slot_booking_id', booking.id).maybeSingle()
    if (existing) {
      return NextResponse.json({ ok: true, spiff: { id: existing.id, alreadyExists: true } })
    }
    const { data: cfg } = await sb.from('spiff_config')
      .select('default_amount_per_appointment_purchase, is_active')
      .limit(1).maybeSingle()
    const amount = cfg?.is_active ? Number(cfg.default_amount_per_appointment_purchase) || 0 : 0
    const { data: spiff, error: spErr } = await sb.from('trunk_show_spiffs').insert({
      trunk_show_id: slot.trunk_show_id,
      slot_booking_id: booking.id,
      store_salesperson_name: booking.store_salesperson_name.trim(),
      amount,
    }).select('id').single()
    if (spErr) return NextResponse.json({ error: spErr.message }, { status: 500 })
    return NextResponse.json({ ok: true, spiff })
  } else {
    const { data: existing } = await sb.from('trunk_show_spiffs')
      .select('id, paid_at').eq('slot_booking_id', booking.id).maybeSingle()
    if (existing) {
      if (existing.paid_at) {
        return NextResponse.json({
          ok: true, spiff: { id: existing.id, paid: true },
          notice: 'Booking un-marked, but a paid spiff exists — admin must reverse it manually.',
        })
      }
      const { error: dErr } = await sb.from('trunk_show_spiffs').delete().eq('id', existing.id)
      if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, spiff: null })
  }
}
