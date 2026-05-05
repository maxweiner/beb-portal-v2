// Public waitlist signup page: /waitlist/<eventId>
//
// Targeted by the per-event QR code generated in the staff UI.
// Anonymous — no auth required. Loads event + store + the
// per-store how-heard options server-side, then renders the
// client form.

import { notFound } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import WaitlistJoinClient from './WaitlistJoinClient'
import WaitlistClosed from './WaitlistClosed'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

export const metadata = { title: 'Join Waitlist' }

export default async function WaitlistSignupPage({
  params,
}: {
  params: { eventId: string }
}) {
  const sb = admin()
  const { data: ev } = await sb
    .from('events')
    .select('id, store_id, store_name, start_date, status')
    .eq('id', params.eventId)
    .maybeSingle()
  if (!ev || ev.status === 'cancelled') notFound()

  const { data: store } = await sb
    .from('stores')
    .select('id, name, city, state, timezone')
    .eq('id', ev.store_id)
    .maybeSingle()

  // Pull the per-store how-heard list from the booking config so
  // the waitlist matches what appointment customers see. Fall back
  // to a generic list when the store has no config.
  const { data: cfg } = await sb
    .from('booking_config')
    .select('hear_about_options')
    .eq('store_id', ev.store_id)
    .maybeSingle()

  const heardOptions = (Array.isArray(cfg?.hear_about_options) && cfg!.hear_about_options.length > 0)
    ? cfg!.hear_about_options as string[]
    : ['Postcard', 'VDP', 'Newspaper', 'Social media', 'Word of mouth', 'Repeat customer', 'Other']

  // Same-day cutoff check: 7pm in the store's local timezone.
  // If we're already past that, render a closed state instead of
  // the form so customers don't waste time filling it in.
  const tz = store?.timezone || 'America/New_York'
  const closed = isAfterCutoff(tz)

  if (closed) {
    return <WaitlistClosed storeName={store?.name || ev.store_name || 'this event'} />
  }

  return (
    <WaitlistJoinClient
      eventId={ev.id}
      storeName={store?.name || ev.store_name || 'this event'}
      cityState={[store?.city, store?.state].filter(Boolean).join(', ')}
      heardOptions={heardOptions}
    />
  )
}

function isAfterCutoff(tz: string): boolean {
  // Format current UTC instant in the store's tz, extract HH:mm.
  // If >= 19:00, the waitlist is closed.
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: 'numeric', hour12: false, minute: '2-digit',
    })
    const parts = fmt.formatToParts(new Date())
    const hour = Number(parts.find(p => p.type === 'hour')?.value ?? 0)
    return hour >= 19
  } catch {
    return false  // unknown timezone — let them sign up; API will re-check
  }
}
