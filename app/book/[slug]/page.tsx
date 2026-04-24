import { notFound } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { getBookingPayload, getStoreBranding } from '@/lib/appointments/serverData'
import { getMockBookingPayload } from '@/lib/appointments/mockData'
import BookingClient from './BookingClient'
import NoEventsPage from './NoEventsPage'

export const metadata = {
  title: 'Book an Appointment',
}

export const dynamic = 'force-dynamic'
export const revalidate = 0

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

export default async function BookingPage({
  params,
  searchParams,
}: {
  params: { slug: string }
  searchParams: { reschedule?: string; src?: string }
}) {
  const real = await getBookingPayload(params.slug)
  const payload = real ?? getMockBookingPayload(params.slug)
  if (!payload) {
    // Store exists but isn't bookable yet → friendly empty state instead of 404.
    const store = await getStoreBranding(params.slug)
    if (store) return <NoEventsPage store={store} />
    notFound()
  }

  const sb = admin()

  let rescheduling: { token: string; customer_name: string; current_date: string; current_time: string } | null = null
  if (searchParams.reschedule) {
    const { data: appt } = await sb
      .from('appointments')
      .select('cancel_token, status, customer_name, appointment_date, appointment_time, store_id')
      .eq('cancel_token', searchParams.reschedule)
      .maybeSingle()
    if (appt && appt.status === 'confirmed' && appt.store_id === payload.store.id) {
      rescheduling = {
        token: appt.cancel_token,
        customer_name: appt.customer_name,
        current_date: appt.appointment_date,
        current_time: appt.appointment_time,
      }
    }
  }

  // QR attribution: arrived from /q/[code] → ?src=<code>. Look up the QR for
  // pre-fill data; the canonical employee/lead-source is re-derived in
  // POST /api/appointments so a tampered qr_code_id can't claim spiff credit.
  let qrAttribution: { qr_code_id: string; pre_fill_how_heard: string | null } | null = null
  if (searchParams.src) {
    const { data: qr } = await sb
      .from('qr_codes')
      .select('id, type, store_id, lead_source, custom_label')
      .eq('code', searchParams.src)
      .maybeSingle()
    if (qr && qr.store_id === payload.store.id) {
      qrAttribution = {
        qr_code_id: qr.id,
        pre_fill_how_heard:
          qr.type === 'channel' ? (qr.lead_source ?? null)
          : qr.type === 'custom' ? (qr.custom_label ?? null)
          : null, // employee QRs don't pre-fill how_heard
      }
    }
  }

  return (
    <BookingClient
      slug={params.slug}
      payload={payload}
      isMock={!real}
      rescheduling={rescheduling}
      qrAttribution={qrAttribution}
    />
  )
}
