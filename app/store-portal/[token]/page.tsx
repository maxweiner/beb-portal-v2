import { notFound } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { getBookingPayload } from '@/lib/appointments/serverData'
import StorePortalClient from './StorePortalClient'

export const metadata = { title: 'Store Portal' }
export const dynamic = 'force-dynamic'
export const revalidate = 0

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

export default async function Page({ params }: { params: { token: string } }) {
  const sb = admin()
  const { data: tokenRow } = await sb
    .from('store_portal_tokens')
    .select('store_id, active')
    .eq('token', params.token)
    .maybeSingle()

  if (!tokenRow || !tokenRow.active) notFound()

  const { data: store } = await sb
    .from('stores')
    .select('slug')
    .eq('id', tokenRow.store_id)
    .maybeSingle()
  if (!store?.slug) notFound()

  const payload = await getBookingPayload(store.slug)
  if (!payload) notFound()

  const eventIds = payload.events.map(e => e.id)

  const [apptsRes, employeesRes] = await Promise.all([
    sb.from('appointments')
      .select('id, cancel_token, status, appointment_date, appointment_time, customer_name, customer_phone, customer_email, items_bringing, how_heard, is_walkin, appointment_employee_id, booked_by')
      .in('event_id', eventIds)
      .neq('status', 'cancelled')
      .order('appointment_date', { ascending: true })
      .order('appointment_time', { ascending: true }),
    sb.from('appointment_employees')
      .select('id, name')
      .eq('store_id', tokenRow.store_id)
      .eq('active', true)
      .order('name'),
  ])

  return (
    <StorePortalClient
      slug={store.slug}
      payload={payload}
      appointments={apptsRes.data ?? []}
      employees={employeesRes.data ?? []}
    />
  )
}
