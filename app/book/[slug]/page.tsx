import { notFound } from 'next/navigation'
import { getBookingPayload } from '@/lib/appointments/serverData'
import { getMockBookingPayload } from '@/lib/appointments/mockData'
import BookingClient from './BookingClient'

export const metadata = {
  title: 'Book an Appointment',
}

// Always render fresh — slot availability depends on the latest bookings.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function BookingPage({ params }: { params: { slug: string } }) {
  const real = await getBookingPayload(params.slug)
  const payload = real ?? getMockBookingPayload(params.slug)
  if (!payload) notFound()

  return <BookingClient slug={params.slug} payload={payload} isMock={!real} />
}
