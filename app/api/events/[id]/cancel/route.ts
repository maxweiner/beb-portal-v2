// POST /api/events/[id]/cancel
//
// Soft-cancels a buying event. Sets events.status='cancelled', records
// cancelled_at + cancelled_by + cancellation_reason. Cascading
// behaviour is opt-in via the body so the operator can fine-tune what
// happens.
//
// Body: {
//   reason: string                       // required
//   cancel_appointments?: boolean        // default false; flips appt rows to status='cancelled'
//   email_buyers?: boolean               // default false
//   email_store_contacts?: boolean       // default false
//   email_customers?: boolean            // default false; only fires if cancel_appointments was true
//   cancel_travel?: boolean              // default false; flips travel_reservations to cancelled
//   void_expenses?: boolean              // default false; flips expense_reports to voided
// }
//
// Always: pauses every marketing_campaigns row tied to the event
// (status → 'paused'). Reasoning: postcards/emails not yet sent
// shouldn't fire after the event is cancelled. Already-mailed pieces
// stay where they are — can't recall USPS.
//
// Auth: caller must be admin/superadmin/partner.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { sendEmail } from '@/lib/email'
import { blockIfImpersonating } from '@/lib/impersonation/server'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch] as string))
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  const sb = admin()
  const { data: caller } = await sb
    .from('users')
    .select('role, is_partner, name, email')
    .eq('id', me.id)
    .maybeSingle()
  const allowed = caller?.role === 'admin' || caller?.role === 'superadmin' || !!caller?.is_partner
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const reason = String(body?.reason || '').trim()
  if (!reason) return NextResponse.json({ error: 'Reason is required' }, { status: 400 })

  const cancelAppointments = body?.cancel_appointments === true
  const emailBuyers        = body?.email_buyers        === true
  const emailStoreContacts = body?.email_store_contacts === true
  const emailCustomers     = body?.email_customers     === true && cancelAppointments
  const cancelTravel       = body?.cancel_travel       === true
  const voidExpenses       = body?.void_expenses       === true

  const { data: event, error: evErr } = await sb
    .from('events')
    .select('id, store_id, store_name, start_date, status, workers, brand, days:event_days(day_number)')
    .eq('id', params.id)
    .maybeSingle()
  if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 })
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
  if (event.status === 'cancelled') {
    return NextResponse.json({ error: 'Event is already cancelled' }, { status: 400 })
  }

  // 1. Cancel the event itself.
  const { error: updErr } = await sb
    .from('events')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancelled_by: me.id,
      cancellation_reason: reason,
    })
    .eq('id', event.id)
  if (updErr) return NextResponse.json({ error: `Event update failed: ${updErr.message}` }, { status: 500 })

  const summary: Record<string, number | string> = { event_status: 'cancelled' }

  // 2. Always pause active marketing campaigns. Already-done campaigns
  //    stay 'done' (postcards already mailed).
  {
    const { data, error } = await sb
      .from('marketing_campaigns')
      .update({ status: 'paused' })
      .eq('event_id', event.id)
      .not('status', 'in', '(done,paused)')
      .select('id')
    if (error) return NextResponse.json({ error: `Pausing campaigns failed: ${error.message}` }, { status: 500 })
    summary.campaigns_paused = (data || []).length
  }

  // 3. Date set for appointment + travel cascades. event_days holds
  //    day_number (1/2/3...) — derive YYYY-MM-DD from start_date +
  //    (day_number - 1). Fall back to start_date + 0..5 days when no
  //    day_number rows exist yet.
  const startDate = new Date(event.start_date + 'T12:00:00')
  const ymd = (d: Date) => d.toISOString().slice(0, 10)
  const dayNumbers: number[] = ((event as any).days || [])
    .map((d: any) => Number(d.day_number))
    .filter((n: any) => Number.isFinite(n) && n >= 1)
  let dateSet: string[] = dayNumbers.map(n => {
    const d = new Date(startDate); d.setUTCDate(startDate.getUTCDate() + (n - 1)); return ymd(d)
  })
  if (dateSet.length === 0) {
    for (let i = 0; i < 6; i++) {
      const d = new Date(startDate); d.setUTCDate(startDate.getUTCDate() + i)
      dateSet.push(ymd(d))
    }
  }

  // 4. Cancel appointments.
  let cancelledCustomerEmails: string[] = []
  if (cancelAppointments) {
    const { data: existingAppts } = await sb
      .from('appointments')
      .select('id, customer_email')
      .eq('store_id', event.store_id)
      .in('appointment_date', dateSet)
      .neq('status', 'cancelled')
    cancelledCustomerEmails = Array.from(new Set(
      (existingAppts || [])
        .map((a: any) => (a.customer_email || '').trim().toLowerCase())
        .filter(Boolean),
    ))
    const ids = (existingAppts || []).map((a: any) => a.id)
    if (ids.length > 0) {
      const { error } = await sb
        .from('appointments')
        .update({ status: 'cancelled' })
        .in('id', ids)
      if (error) return NextResponse.json({ error: `Cancelling appointments failed: ${error.message}` }, { status: 500 })
    }
    summary.appointments_cancelled = ids.length
  }

  // 5. Cancel travel reservations (best-effort: column shape varies).
  if (cancelTravel) {
    const { data: trv, error } = await sb
      .from('travel_reservations')
      .update({ status: 'cancelled' })
      .eq('event_id', event.id)
      .select('id')
    if (error) return NextResponse.json({ error: `Travel cancel failed: ${error.message}` }, { status: 500 })
    summary.travel_cancelled = (trv || []).length
  }

  // 6. Void expense reports.
  if (voidExpenses) {
    const { data: exp, error } = await sb
      .from('expense_reports')
      .update({ status: 'voided' })
      .eq('event_id', event.id)
      .neq('status', 'paid')
      .select('id')
    if (error) return NextResponse.json({ error: `Voiding expenses failed: ${error.message}` }, { status: 500 })
    summary.expenses_voided = (exp || []).length
  }

  // 7. Notifications. Failures are tolerated (logged + counted).
  const fmtLong = (ds: string) =>
    new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const eventLabel = `${event.store_name} on ${fmtLong(event.start_date)}`
  const senderName = caller?.name || 'BEB Operations'

  const buyerHtml = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a16;max-width:560px;margin:0 auto;padding:20px;background:#F5F0E8">
      <div style="background:#B22234;color:#fff;font-weight:700;font-size:13px;padding:6px 14px;border-radius:14px;display:inline-block;margin-bottom:14px">
        Event cancelled
      </div>
      <h2 style="margin:0 0 6px;font-size:18px">The buying trip you were assigned to is cancelled</h2>
      <p style="margin:0 0 12px;color:#4A4A42">Event: <b>${escapeHtml(eventLabel)}</b></p>
      <p style="margin:0 0 12px;color:#4A4A42"><b>Reason:</b> ${escapeHtml(reason)}</p>
      <p style="margin:0 0 16px;color:#4A4A42">Your travel for this trip is freed up. Coordinate with the office on next steps.</p>
      <p style="margin:16px 0 0;color:#A8A89A;font-size:12px">Sent by ${escapeHtml(senderName)}</p>
    </div>
  `
  const storeHtml = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a16;max-width:560px;margin:0 auto;padding:20px;background:#F5F0E8">
      <div style="background:#B22234;color:#fff;font-weight:700;font-size:13px;padding:6px 14px;border-radius:14px;display:inline-block;margin-bottom:14px">
        Buying event cancelled
      </div>
      <h2 style="margin:0 0 6px;font-size:18px">Beneficial Estate Buyers — event cancellation</h2>
      <p style="margin:0 0 12px;color:#4A4A42">We're sorry to share that the upcoming event at <b>${escapeHtml(event.store_name)}</b> on <b>${escapeHtml(fmtLong(event.start_date))}</b> has been cancelled.</p>
      <p style="margin:0 0 12px;color:#4A4A42"><b>Reason:</b> ${escapeHtml(reason)}</p>
      ${cancelAppointments ? '<p style="margin:0 0 12px;color:#4A4A42">Customers who had appointments are being notified separately.</p>' : ''}
      <p style="margin:0 0 16px;color:#4A4A42">We'll be in touch about rescheduling.</p>
      <p style="margin:16px 0 0;color:#A8A89A;font-size:12px">— Beneficial Estate Buyers</p>
    </div>
  `
  const customerHtml = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a16;max-width:560px;margin:0 auto;padding:20px;background:#F5F0E8">
      <div style="background:#B22234;color:#fff;font-weight:700;font-size:13px;padding:6px 14px;border-radius:14px;display:inline-block;margin-bottom:14px">
        Appointment cancelled
      </div>
      <h2 style="margin:0 0 6px;font-size:18px">Your appointment with Beneficial Estate Buyers</h2>
      <p style="margin:0 0 12px;color:#4A4A42">Unfortunately the buying event at <b>${escapeHtml(event.store_name)}</b> on <b>${escapeHtml(fmtLong(event.start_date))}</b> has been cancelled, so your appointment is cancelled as well.</p>
      <p style="margin:0 0 12px;color:#4A4A42">We're sorry for the inconvenience. Please reach out to the store to reschedule once a new date is announced.</p>
    </div>
  `

  let emailsSent = 0
  let emailsFailed = 0

  // Buyers
  if (emailBuyers) {
    const ids: string[] = Array.isArray(event.workers)
      ? event.workers.map((w: any) => w?.id).filter(Boolean)
      : []
    if (ids.length > 0) {
      const { data: us } = await sb.from('users').select('email').in('id', ids)
      const targets = (us || [])
        .map((u: any) => u.email)
        .filter((e: any): e is string => typeof e === 'string' && e.includes('@') && !/placeholder\.bebllp\.local$/i.test(e))
      for (const to of targets) {
        try {
          await sendEmail({ to, subject: `Trip cancelled — ${event.store_name}`, html: buyerHtml })
          emailsSent++
        } catch { emailsFailed++ }
      }
    }
  }

  // Store contacts
  if (emailStoreContacts) {
    const { data: contacts } = await sb
      .from('store_contacts')
      .select('email')
      .eq('store_id', event.store_id)
    const targets = (contacts || [])
      .map((c: any) => c.email)
      .filter((e: any): e is string => typeof e === 'string' && e.includes('@'))
    for (const to of targets) {
      try {
        await sendEmail({ to, subject: `Event cancelled — ${event.store_name}`, html: storeHtml })
        emailsSent++
      } catch { emailsFailed++ }
    }
  }

  // Customers (only when appointments were also cancelled)
  if (emailCustomers) {
    for (const to of cancelledCustomerEmails) {
      try {
        await sendEmail({ to, subject: `Appointment cancelled — ${event.store_name}`, html: customerHtml })
        emailsSent++
      } catch { emailsFailed++ }
    }
  }

  summary.emails_sent = emailsSent
  summary.emails_failed = emailsFailed

  return NextResponse.json({ ok: true, summary })
}
