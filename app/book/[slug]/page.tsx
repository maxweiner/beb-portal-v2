import { notFound } from 'next/navigation'
import { getMockBookingPayload } from '@/lib/appointments/mockData'
import BookingClient from './BookingClient'

export const metadata = {
  title: 'Book an Appointment',
}

export default function BookingPage({ params }: { params: { slug: string } }) {
  const payload = getMockBookingPayload(params.slug)
  if (!payload) notFound()

  return <BookingClient payload={payload} />
}
