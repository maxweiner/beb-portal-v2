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
    .select('id, trunk_show_id, expires_at')
    .eq('token', token).maybeSingle()
  if (error || !data) return null
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
    .select('name, city, state, address').eq('id', show.store_id).maybeSingle()

  const { data: slots } = await sb.from('trunk_show_appointment_slots')
    .select('id, slot_start, slot_end, status')
    .eq('trunk_show_id', t.trunk_show_id)
    .eq('status', 'available')
    .order('slot_start', { ascending: true })

  await sb.from('trunk_show_booking_tokens')
    .update({ last_used_at: new Date().toISOString() }).eq('id', t.id)

  return NextResponse.json({
    show: { ...show, store: store || null },
    slots: (slots || []).map(s => ({ id: s.id, slot_start: s.slot_start, slot_end: s.slot_end })),
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
    .select('id, trunk_show_id, status').eq('id', slotId).maybeSingle()
  if (!slot || slot.trunk_show_id !== t.trunk_show_id) {
    return NextResponse.json({ error: 'Slot not found' }, { status: 404 })
  }
  if (slot.status !== 'available') {
    return NextResponse.json({ error: 'That slot is no longer available — pick another.' }, { status: 409 })
  }

  const norm = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null)
  const { error: upErr } = await sb.from('trunk_show_appointment_slots').update({
    status: 'booked',
    customer_first_name: first_name.trim(),
    customer_last_name:  norm(last_name),
    customer_email:      norm(email),
    customer_phone:      norm(phone),
    store_salesperson_name: norm(salesperson),
    notes: norm(notes),
  }).eq('id', slot.id)
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  await sb.from('trunk_show_booking_tokens')
    .update({ last_used_at: new Date().toISOString() }).eq('id', t.id)

  return NextResponse.json({ ok: true })
}
