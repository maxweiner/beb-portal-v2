// POST /api/waitlist/entry/[id]/call
//
// Staff action: mark a waitlist entry as 'called' (the next-up
// notification). When the customer chose notify_pref='sms', also
// sends them the "you're up" text. SMS failure does NOT prevent
// the status flip — staff can fall back to calling the name.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { sendSMS, formatPhone } from '@/lib/sms'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = admin()
  const { data: entry } = await sb
    .from('event_waitlist')
    .select('id, event_id, name, phone, notify_pref, status, events(store_name, store_id, stores(name))')
    .eq('id', params.id)
    .maybeSingle()
  if (!entry) return NextResponse.json({ error: 'Entry not found' }, { status: 404 })
  if (entry.status === 'called' || entry.status === 'served') {
    return NextResponse.json({ error: `Already ${entry.status}` }, { status: 409 })
  }

  const { error } = await sb.from('event_waitlist').update({
    status: 'called',
    called_at: new Date().toISOString(),
    called_by_user_id: me.id,
  }).eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let sms_sent = false
  if (entry.notify_pref === 'sms') {
    try {
      const ev = entry.events as any
      const storeName = ev?.stores?.name || ev?.store_name || 'the event'
      await sendSMS(
        formatPhone(entry.phone),
        `You're up next at ${storeName}! Please head over now.`,
      )
      sms_sent = true
    } catch {
      // best-effort
    }
  }

  return NextResponse.json({ ok: true, sms_sent })
}
