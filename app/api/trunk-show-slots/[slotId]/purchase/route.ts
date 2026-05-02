// POST /api/trunk-show-slots/[slotId]/purchase
//
// Body: { purchased: boolean }
//
// Flips a trunk-show appointment slot's `purchased` flag and (in
// the same call) creates or removes the corresponding row in
// trunk_show_spiffs. Service-role write lets sales reps trigger
// the spiff insert without holding admin RLS write privileges
// on trunk_show_spiffs.
//
// Spiff creation rules:
//   - On purchased=true: insert a row using the slot's
//     store_salesperson_name + spiff_config.default_amount.
//     Skip if no salesperson_name (can't credit a payout without
//     a name) or if a row already exists for this slot.
//   - On purchased=false: delete the unpaid spiff for this slot.
//     If the spiff has paid_at set, refuse — admin must manually
//     reverse paid spiffs.

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

export async function POST(req: Request, { params }: { params: { slotId: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const purchased = !!body?.purchased
  const sb = admin()

  const { data: slot, error: slotErr } = await sb
    .from('trunk_show_appointment_slots')
    .select('id, trunk_show_id, store_salesperson_name, purchased')
    .eq('id', params.slotId).maybeSingle()
  if (slotErr) return NextResponse.json({ error: slotErr.message }, { status: 500 })
  if (!slot) return NextResponse.json({ error: 'Slot not found' }, { status: 404 })

  // Authorization check: sales rep on this trunk show, OR admin /
  // partner. Buyers can't reach this far through the UI, but the
  // RLS-equivalent check happens here since service role bypasses.
  const { data: show } = await sb.from('trunk_shows')
    .select('assigned_rep_id').eq('id', slot.trunk_show_id).maybeSingle()
  const isAdmin = me.role === 'admin' || me.role === 'superadmin' || me.is_partner
  const isAssignedRep = show?.assigned_rep_id === me.id
  if (!isAdmin && !isAssignedRep) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Update slot.
  const { error: upErr } = await sb.from('trunk_show_appointment_slots').update({
    purchased,
    purchased_marked_by: purchased ? me.id : null,
    purchased_marked_at: purchased ? new Date().toISOString() : null,
  }).eq('id', slot.id)
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  if (purchased) {
    if (!slot.store_salesperson_name?.trim()) {
      // No salesperson recorded — slot is marked purchased but no
      // spiff is owed. Surface a notice rather than silently
      // skipping so the rep can add the salesperson and re-mark.
      return NextResponse.json({ ok: true, spiff: null, notice: 'Marked purchased, but no spiff was created — add the store salesperson on the slot first.' })
    }
    // Skip if a spiff already exists for this slot.
    const { data: existing } = await sb.from('trunk_show_spiffs')
      .select('id').eq('appointment_slot_id', slot.id).maybeSingle()
    if (existing) {
      return NextResponse.json({ ok: true, spiff: { id: existing.id, alreadyExists: true } })
    }
    // Pull config amount.
    const { data: cfg } = await sb.from('spiff_config')
      .select('default_amount_per_appointment_purchase, is_active')
      .limit(1).maybeSingle()
    const amount = cfg?.is_active ? Number(cfg.default_amount_per_appointment_purchase) || 0 : 0
    const { data: spiff, error: spErr } = await sb.from('trunk_show_spiffs').insert({
      trunk_show_id: slot.trunk_show_id,
      appointment_slot_id: slot.id,
      store_salesperson_name: slot.store_salesperson_name.trim(),
      amount,
    }).select('id').single()
    if (spErr) return NextResponse.json({ error: spErr.message }, { status: 500 })
    return NextResponse.json({ ok: true, spiff })
  } else {
    // purchased=false: clean up the unpaid spiff if present.
    const { data: existing } = await sb.from('trunk_show_spiffs')
      .select('id, paid_at').eq('appointment_slot_id', slot.id).maybeSingle()
    if (existing) {
      if (existing.paid_at) {
        return NextResponse.json({
          ok: true, spiff: { id: existing.id, paid: true },
          notice: 'Slot un-marked, but a paid spiff exists — admin must reverse it manually.',
        })
      }
      const { error: dErr } = await sb.from('trunk_show_spiffs').delete().eq('id', existing.id)
      if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, spiff: null })
  }
}
