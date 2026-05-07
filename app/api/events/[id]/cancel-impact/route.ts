// GET /api/events/[id]/cancel-impact
//
// Returns counts + lists for the Cancel-Event modal so the user can
// see what they're about to do before they click Confirm:
//   - assigned buyers (name + email)
//   - store contacts (name + email)
//   - confirmed appointments at this store on event days
//   - travel reservations belonging to those buyers for the event
//   - expense reports tied to the event
//   - marketing campaigns tied to the event

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

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = admin()

  // Caller must be admin/superadmin/partner.
  const { data: caller } = await sb
    .from('users')
    .select('role, is_partner')
    .eq('id', me.id)
    .maybeSingle()
  const allowed = caller?.role === 'admin' || caller?.role === 'superadmin' || !!caller?.is_partner
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: event, error: evErr } = await sb
    .from('events')
    .select('id, store_id, store_name, start_date, status, workers, days:event_days(day_number)')
    .eq('id', params.id)
    .maybeSingle()
  if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 })
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

  // Buyers — resolve current emails from public.users by id list.
  const workerIds: string[] = Array.isArray(event.workers)
    ? event.workers.map((w: any) => w?.id).filter((x: any) => typeof x === 'string')
    : []
  let buyers: { id: string; name: string; email: string }[] = []
  if (workerIds.length > 0) {
    const { data: us } = await sb.from('users').select('id, name, email').in('id', workerIds)
    buyers = (us || [])
      .filter((u: any) => u.email && !/placeholder\.bebllp\.local$/i.test(u.email))
      .map((u: any) => ({ id: u.id, name: u.name || u.email, email: u.email }))
  }

  // Store contacts.
  const { data: contacts } = await sb
    .from('store_contacts')
    .select('id, name, title, email')
    .eq('store_id', event.store_id)
  const storeContacts = (contacts || [])
    .filter((c: any) => c.email && c.email.includes('@'))
    .map((c: any) => ({
      id: c.id,
      name: c.name,
      title: c.title || null,
      email: c.email,
    }))

  // Appointments — at this store on this event's days. event_days has
  // day_number (1/2/3 etc.), not literal dates; derive YYYY-MM-DD from
  // events.start_date + (day_number - 1). When day_numbers haven't
  // been seeded yet, fall back to a +5-day window from start_date as
  // a conservative bound.
  const dayNumbers: number[] = ((event as any).days || [])
    .map((d: any) => Number(d.day_number))
    .filter((n: any) => Number.isFinite(n) && n >= 1)
  const ymd = (d: Date) => d.toISOString().slice(0, 10)
  const startDate = new Date(event.start_date + 'T12:00:00')
  const eventDays: string[] = dayNumbers
    .map(n => { const d = new Date(startDate); d.setUTCDate(startDate.getUTCDate() + (n - 1)); return ymd(d) })
  let apptCount = 0
  let customerEmails: string[] = []
  {
    const apptQuery = sb
      .from('appointments')
      .select('id, customer_email, status', { count: 'exact' })
      .eq('store_id', event.store_id)
      .neq('status', 'cancelled')
    if (eventDays.length > 0) apptQuery.in('appointment_date', eventDays)
    else {
      const end = new Date(startDate); end.setUTCDate(startDate.getUTCDate() + 5)
      apptQuery
        .gte('appointment_date', event.start_date)
        .lte('appointment_date', ymd(end))
    }
    const { data: appts, count } = await apptQuery
    apptCount = count || 0
    customerEmails = Array.from(new Set(
      (appts || []).map((a: any) => (a.customer_email || '').trim().toLowerCase()).filter(Boolean),
    ))
  }

  // Travel reservations.
  const { count: travelCount } = await sb
    .from('travel_reservations')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', event.id)

  // Expense reports.
  const { count: expenseCount } = await sb
    .from('expense_reports')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', event.id)

  // Marketing campaigns. Only count rows that are still active (anything
  // not 'done' or 'paused' — we'd be flipping these to 'paused').
  const { count: campaignCount } = await sb
    .from('marketing_campaigns')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', event.id)
    .not('status', 'in', '(done,paused)')

  return NextResponse.json({
    event: {
      id: event.id,
      store_name: event.store_name,
      start_date: event.start_date,
      status: event.status,
      cancelled: event.status === 'cancelled',
    },
    buyers,
    storeContacts,
    appointments: { count: apptCount, customer_emails: customerEmails },
    travel: { count: travelCount || 0 },
    expenses: { count: expenseCount || 0 },
    campaigns: { count: campaignCount || 0 },
  })
}
