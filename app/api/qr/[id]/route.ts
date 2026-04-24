// DELETE /api/qr/[id]
//
// Soft-deletes a QR code by setting deleted_at = now(). Per spec §5, the
// QR continues to redirect during a 60-day trash window — that's enforced
// in the lookup at /q/[code], not here. The full trash UI + daily digest
// land in a later chunk.
//
// PUT /api/qr/[id]  { label?, custom_label?, appointment_employee_id? }
//
// Updates editable QR attributes. The `code`, `type`, `store_id`,
// `store_group_id`, and `lead_source` are immutable — changing those after
// printing would silently break attribution on already-distributed materials.

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

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const sb = admin()
  const { error } = await sb.from('qr_codes')
    .update({ deleted_at: new Date().toISOString(), active: false })
    .eq('id', params.id)
    .is('deleted_at', null)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const updates: Record<string, any> = {}
  if (typeof body?.label === 'string') {
    if (!body.label.trim()) return NextResponse.json({ error: 'label cannot be empty' }, { status: 400 })
    updates.label = body.label.trim()
  }
  if (Object.prototype.hasOwnProperty.call(body, 'custom_label')) {
    updates.custom_label = body.custom_label ? String(body.custom_label).trim() : null
  }
  if (Object.prototype.hasOwnProperty.call(body, 'appointment_employee_id')) {
    updates.appointment_employee_id = body.appointment_employee_id || null
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const sb = admin()
  const { data, error } = await sb.from('qr_codes')
    .update(updates)
    .eq('id', params.id)
    .select('id, label, custom_label, appointment_employee_id')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true, qr: data })
}
