import { notFound } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import ManageClient from './ManageClient'

export const metadata = { title: 'Manage your appointment' }
export const dynamic = 'force-dynamic'
export const revalidate = 0

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

export default async function ManagePage({ params }: { params: { token: string } }) {
  const sb = admin()
  const { data: appt } = await sb
    .from('appointments')
    .select('id, cancel_token, status, appointment_date, appointment_time, customer_name, store_id')
    .eq('cancel_token', params.token)
    .maybeSingle()
  if (!appt) notFound()

  const { data: store } = await sb
    .from('stores')
    .select('name, slug, color_primary, color_secondary, store_image_url, owner_phone, owner_email')
    .eq('id', appt.store_id)
    .maybeSingle()
  if (!store) notFound()

  return <ManageClient token={params.token} appt={appt} store={store} />
}
