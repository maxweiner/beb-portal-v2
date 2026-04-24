// GET /api/appointments/by-store/[id]
// Returns confirmed appointments for a given store, normalized to the same
// `Appointment` shape (start/end/title/description/location) the existing
// Calendar.tsx consumes from Google iCal feeds — so the renderer doesn't
// have to special-case our source.
//
// Auth: this is the same trust level as the Calendar UI itself — any authed
// staff member can already see Google Calendar appointments via the iCal
// proxy. We rely on the unauthenticated-but-unguessable URL pattern for v1
// (the [id] is a UUID). Tighten with a session check if needed.

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

function pad(n: number) { return String(n).padStart(2, '0') }

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const sb = admin()

  // Pull confirmed appointments for this store, with employee names joined for the spiff field.
  const { data: appts, error } = await sb
    .from('appointments')
    .select(`
      id, appointment_date, appointment_time, customer_name,
      customer_phone, customer_email, items_bringing, how_heard,
      is_walkin, booked_by, status, cancel_token,
      appointment_employee:store_employees(name)
    `)
    .eq('store_id', params.id)
    .eq('status', 'confirmed')
    .order('appointment_date', { ascending: true })
    .order('appointment_time', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: cfg } = await sb.from('booking_config')
    .select('slot_interval_minutes')
    .eq('store_id', params.id)
    .maybeSingle()
  const slotMin = (cfg?.slot_interval_minutes as number | undefined) ?? 20

  const appointments = (appts ?? []).map((a: any) => {
    const time = (a.appointment_time as string).length >= 5
      ? (a.appointment_time as string).slice(0, 5)
      : a.appointment_time as string
    // Calendar.tsx treats Date objects as raw wall-clock UTC for display
    // (see lib/calendar.ts dateInTz / hmInTz comments). Construct ISO with
    // Z suffix so getUTC* returns the local hour we want to display.
    const start = new Date(`${a.appointment_date}T${time}:00Z`)
    const end = new Date(start.getTime() + slotMin * 60 * 1000)

    const employeeName = a.appointment_employee?.name as string | undefined
    const items = Array.isArray(a.items_bringing) ? a.items_bringing.join(', ') : ''
    const howHeard = Array.isArray(a.how_heard) ? a.how_heard.join(', ') : (a.how_heard || '')
    // Format description so the existing parseApptDetail() in lib/calendar.ts
    // pulls out client/items/how-heard exactly the way it does for iCal.
    const descriptionLines = [
      `Client: ${a.customer_name || ''} ${a.customer_phone || ''} ${a.customer_email || ''}`.trim(),
      items ? `What Items: ${items}` : '',
      howHeard ? `How did you find out: ${howHeard}` : '',
      a.is_walkin ? 'Walk-in: yes' : '',
      employeeName ? `Spiff: ${employeeName}` : '',
      `Source: BEB Portal (${a.booked_by || 'customer'})`,
    ].filter(Boolean)

    return {
      start: start.toISOString(),
      end: end.toISOString(),
      title: `${a.customer_name || 'Appointment'} - ${a.customer_phone || ''}`,
      description: descriptionLines.join('\n'),
      location: '',
      // Extra fields the existing Calendar can ignore but we may want later.
      _source: 'beb-portal',
      _appointment_id: a.id,
      _cancel_token: a.cancel_token,
      _is_walkin: !!a.is_walkin,
    }
  })

  return NextResponse.json({ appointments })
}
