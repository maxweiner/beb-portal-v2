// Public trade-show booth-appointment booking endpoint. Token-
// gated (no Supabase Auth needed) — anyone with the magic link
// can read available slots and book one. Service role bypasses
// RLS for the read + write since the caller is anonymous.
//
// GET  → { show, slots }
// POST → { slotId, name, email?, phone?, notes? } → 200/400/404

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
    .from('trade_show_booking_tokens')
    .select('id, trade_show_id, expires_at')
    .eq('token', token)
    .maybeSingle()
  if (error || !data) return null
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null
  return data
}

export async function GET(req: Request, { params }: { params: { token: string } }) {
  const t = await resolveToken(params.token)
  if (!t) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404 })
  const sb = admin()
  const { data: show } = await sb.from('trade_shows')
    .select('id, name, venue_name, venue_city, venue_state, start_date, end_date, booth_number')
    .eq('id', t.trade_show_id).is('deleted_at', null).maybeSingle()
  if (!show) return NextResponse.json({ error: 'Show not found' }, { status: 404 })
  const { data: slots } = await sb.from('trade_show_appointments')
    .select('id, slot_start, slot_end, status, assigned_staff_id')
    .eq('trade_show_id', t.trade_show_id)
    .eq('status', 'available')
    .order('slot_start', { ascending: true })

  // Resolve assigned-staff names for the rep picker. Only fetch
  // names for staff_ids that actually appear on slots.
  const staffIds = Array.from(new Set((slots || []).map(s => s.assigned_staff_id).filter(Boolean) as string[]))
  let staffNames: Record<string, string> = {}
  if (staffIds.length > 0) {
    const { data: u } = await sb.from('users').select('id, name').in('id', staffIds)
    for (const r of (u || [])) staffNames[r.id] = (r as any).name || 'Rep'
  }

  // touch last_used_at as a low-fidelity engagement signal
  await sb.from('trade_show_booking_tokens')
    .update({ last_used_at: new Date().toISOString() }).eq('id', t.id)

  return NextResponse.json({
    show,
    slots: (slots || []).map(s => ({
      id: s.id, slot_start: s.slot_start, slot_end: s.slot_end,
      assigned_staff_id: s.assigned_staff_id || null,
      assigned_staff_name: s.assigned_staff_id ? (staffNames[s.assigned_staff_id] || null) : null,
    })),
  })
}

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const t = await resolveToken(params.token)
  if (!t) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404 })

  let body: any
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { slotId, name, email, phone, notes } = body || {}
  if (!slotId || !name?.trim()) {
    return NextResponse.json({ error: 'Missing slot or name' }, { status: 400 })
  }

  const sb = admin()
  // Verify slot belongs to the same show + still available.
  const { data: slot } = await sb.from('trade_show_appointments')
    .select('id, trade_show_id, status')
    .eq('id', slotId).maybeSingle()
  if (!slot || slot.trade_show_id !== t.trade_show_id) {
    return NextResponse.json({ error: 'Slot not found' }, { status: 404 })
  }
  if (slot.status !== 'available') {
    return NextResponse.json({ error: 'That slot is no longer available — pick another.' }, { status: 409 })
  }

  const norm = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null)
  const { error: upErr } = await sb.from('trade_show_appointments').update({
    status: 'booked',
    booked_by_external_name:  name.trim(),
    booked_by_external_email: norm(email),
    booked_by_external_phone: norm(phone),
    notes: norm(notes),
  }).eq('id', slot.id)
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  await sb.from('trade_show_booking_tokens')
    .update({ last_used_at: new Date().toISOString() }).eq('id', t.id)

  return NextResponse.json({ ok: true })
}
