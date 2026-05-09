// DELETE /api/intake/[id]
//
// Hard-deletes an intake row and every photo associated with it.
// Superadmin only — buy-form numbers are globally unique forever, so
// deleting one frees that number for reuse, and we want that gated.
//
// What gets removed:
//   • Storage objects under license-photos/{event_id}/{intake_id}/*
//   • Rows in intake_photos        (FK ON DELETE CASCADE)
//   • Rows in intake_audit_log     (FK ON DELETE CASCADE)
//   • The customer_intakes row itself
//
// We do NOT delete the linked customers row (other intakes might
// reference it) or the appointments row.

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

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const intakeId = params.id
  if (!intakeId) return NextResponse.json({ error: 'Missing intake id' }, { status: 400 })

  const caller = await getAuthedUser(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (caller.role !== 'superadmin') {
    return NextResponse.json({ error: 'Superadmin only' }, { status: 403 })
  }

  const sb = admin()

  // Lookup event_id so we can wipe the storage prefix.
  const { data: intake, error: lookupErr } = await sb
    .from('customer_intakes')
    .select('id, event_id, buy_form_number')
    .eq('id', intakeId)
    .single()
  if (lookupErr || !intake) {
    return NextResponse.json({ error: lookupErr?.message || 'Intake not found' }, { status: 404 })
  }

  // List + delete every storage object under this intake's prefix.
  // Best-effort; a failed wipe shouldn't block the row delete.
  const prefix = `${intake.event_id}/${intakeId}`
  try {
    const { data: files } = await sb.storage
      .from('license-photos')
      .list(prefix, { limit: 100 })
    if (files && files.length > 0) {
      const paths = files.map(f => `${prefix}/${f.name}`)
      const { error: rmErr } = await sb.storage.from('license-photos').remove(paths)
      if (rmErr) console.warn('[intake delete] storage remove failed', rmErr)
    }
  } catch (e) {
    console.warn('[intake delete] storage cleanup threw', e)
  }

  // Delete the row. FK cascades take care of intake_photos +
  // intake_audit_log. The unique partial index on buy_form_number
  // releases the number for reuse the moment the row is gone.
  const { error: delErr } = await sb.from('customer_intakes').delete().eq('id', intakeId)
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    deletedFormNumber: intake.buy_form_number,
  })
}
