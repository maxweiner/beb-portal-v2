// POST /api/buying-event-spiffs/payouts
//
// Body: {
//   event_id: string,
//   appointment_employee_id: string,
//   employee_name: string,
//   amount: number,
//   appointments_count: number,
//   notes?: string
// }
//
// Partner-only. Records a one-step "Mark Paid" for a store staff
// member's spiff on a given event. Snapshots employee_name + amount
// + paid_by_name so the row survives later edits / deletions.
//
// The DB has UNIQUE (event_id, appointment_employee_id) so re-paying
// the same employee on the same event will 409. Use PATCH (later) to
// adjust an existing payout if needed.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { blockIfImpersonating } from '@/lib/impersonation/server'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function POST(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!me.is_partner) {
    return NextResponse.json({ error: 'Partner role required to mark spiffs paid' }, { status: 403 })
  }

  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  const body = await req.json().catch(() => ({}))
  const event_id = String(body.event_id || '')
  const appointment_employee_id = String(body.appointment_employee_id || '')
  const employee_name = String(body.employee_name || '').trim()
  const amount = Number(body.amount)
  const appointments_count = Number(body.appointments_count)
  const notes = body.notes ? String(body.notes) : null

  if (!event_id || !appointment_employee_id || !employee_name) {
    return NextResponse.json({ error: 'event_id, appointment_employee_id, employee_name required' }, { status: 400 })
  }
  if (!Number.isFinite(amount) || amount < 0) {
    return NextResponse.json({ error: 'amount must be a non-negative number' }, { status: 400 })
  }
  if (!Number.isInteger(appointments_count) || appointments_count < 0) {
    return NextResponse.json({ error: 'appointments_count must be a non-negative integer' }, { status: 400 })
  }

  const sb = admin()
  const { data, error } = await sb
    .from('buying_event_spiff_payouts')
    .insert({
      event_id,
      appointment_employee_id,
      employee_name,
      amount,
      appointments_count,
      notes,
      paid_by_user_id: me.id,
      paid_by_name: me.name,
    })
    .select()
    .maybeSingle()

  if (error) {
    if ((error as any).code === '23505') {
      return NextResponse.json({ error: 'Already paid for this employee on this event' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ payout: data })
}
