import { notFound } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { getBookingPayload } from '@/lib/appointments/serverData'
import { getMockBookingPayload } from '@/lib/appointments/mockData'
import BookingClient from './BookingClient'

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
  searchParams: { reschedule?: string }
}) {
  const real = await getBookingPayload(params.slug)
  const payload = real ?? getMockBookingPayload(params.slug)
  if (!payload) notFound()

  let rescheduling: { token: string; customer_name: string; current_date: string; current_time: string } | null = null
  if (searchParams.reschedule) {
    const sb = admin()
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

  return (
    <BookingClient
      slug={params.slug}
      payload={payload}
      isMock={!real}
      rescheduling={rescheduling}
    />
  )
}
