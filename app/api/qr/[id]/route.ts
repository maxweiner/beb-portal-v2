// DELETE /api/qr/[id]
//
// Soft-deletes a QR code by setting deleted_at = now(). Per spec §5, the
// QR continues to redirect during a 60-day trash window — that's enforced
// in the lookup at /q/[code], not here. The full trash UI + daily digest
// land in a later chunk.
//
// PUT /api/qr/[id]
// { label?, custom_label?, appointment_employee_id?, lead_source?, type?, store_id? }
//
// Updates editable QR attributes. The `code` itself stays immutable — it's
// what the printed material encodes, so changing it would dead-link every
// already-distributed copy. Everything else can be edited; the admin UI
// surfaces warnings on the risky changes (type, lead_source, store_id).

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

const VALID_TYPES = new Set(['channel', 'custom', 'employee', 'group'])

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k)
  const updates: Record<string, any> = {}

  if (typeof body?.label === 'string') {
    if (!body.label.trim()) return NextResponse.json({ error: 'label cannot be empty' }, { status: 400 })
    updates.label = body.label.trim()
  }
  if (has('custom_label')) {
    updates.custom_label = body.custom_label ? String(body.custom_label).trim() : null
  }
  if (has('appointment_employee_id')) {
    updates.appointment_employee_id = body.appointment_employee_id || null
  }
  if (has('lead_source')) {
    updates.lead_source = body.lead_source ? String(body.lead_source).trim() : null
  }
  if (has('type')) {
    if (!VALID_TYPES.has(body.type)) {
      return NextResponse.json({ error: `Invalid type: ${body.type}` }, { status: 400 })
    }
    updates.type = body.type
  }
  if (has('store_id')) {
    if (!body.store_id) return NextResponse.json({ error: 'store_id cannot be empty' }, { status: 400 })
    updates.store_id = body.store_id
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const sb = admin()
  const { data, error } = await sb.from('qr_codes')
    .update(updates)
    .eq('id', params.id)
    .select('id, label, type, lead_source, custom_label, appointment_employee_id, store_id, store_group_id')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true, qr: data })
}
