// GET    /api/appointments/[token]  → fetch appointment for the manage page
// DELETE /api/appointments/[token]  → cancel (sets status='cancelled', sends notice)

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendCancellation } from '@/lib/appointments/notifications'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

async function loadAppt(sb: ReturnType<typeof admin>, token: string) {
  const { data: appt } = await sb
    .from('appointments')
    .select('id, cancel_token, status, appointment_date, appointment_time, customer_name, customer_phone, customer_email, items_bringing, how_heard, store_id, event_id')
    .eq('cancel_token', token)
    .maybeSingle()
  if (!appt) return { appt: null, store: null }

  const { data: store } = await sb
    .from('stores')
    .select('name, slug, owner_phone, owner_email, color_primary, color_secondary, store_image_url')
    .eq('id', appt.store_id)
    .maybeSingle()

  return { appt, store }
}

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const sb = admin()
  const { appt, store } = await loadAppt(sb, params.token)
  if (!appt) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ appointment: appt, store })
}

export async function DELETE(_req: Request, { params }: { params: { token: string } }) {
  const sb = admin()
  const { appt, store } = await loadAppt(sb, params.token)
  if (!appt) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (appt.status === 'cancelled') {
    return NextResponse.json({ ok: true, already: true })
  }

  const { error } = await sb
    .from('appointments')
    .update({ status: 'cancelled' })
    .eq('id', appt.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (store) {
    sendCancellation({
      appt: {
        id: appt.id,
        cancel_token: appt.cancel_token,
        customer_name: appt.customer_name,
        customer_phone: appt.customer_phone,
        customer_email: appt.customer_email,
        appointment_date: appt.appointment_date,
        appointment_time: appt.appointment_time,
      },
      store: {
        name: store.name,
        slug: store.slug,
        owner_phone: store.owner_phone,
        owner_email: store.owner_email,
      },
    }).catch(err => console.error('sendCancellation failed', err))
  }

  return NextResponse.json({ ok: true })
}
