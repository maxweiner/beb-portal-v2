// PATCH /api/communications/[id]/reschedule
//
// Body: { scheduled_for_date: 'YYYY-MM-DD' }
//
// Only valid while delivery_status='scheduled'. Recomputes the 9 AM
// store-local timestamp using the new date.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { nineAmInTz, tzForState } from '@/lib/communications/scheduleTime'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const newDate = String(body?.scheduled_for_date || '').trim()
  if (!ISO_DATE.test(newDate)) {
    return NextResponse.json({ error: 'scheduled_for_date must be YYYY-MM-DD' }, { status: 400 })
  }

  const sb = admin()
  const { data: row } = await sb
    .from('communication_sends')
    .select('id, delivery_status, scheduled_by_user_id, trunk_show_id')
    .eq('id', params.id)
    .maybeSingle()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (row.delivery_status !== 'scheduled') {
    return NextResponse.json({ error: 'Only pending scheduled sends can be rescheduled.' }, { status: 400 })
  }

  const isAdminLike = me.role === 'admin' || me.role === 'superadmin' || !!me.is_partner
  if (!isAdminLike && row.scheduled_by_user_id !== me.id) {
    return NextResponse.json({ error: 'Forbidden — you didn\'t schedule this send.' }, { status: 403 })
  }

  const { data: ts } = await sb
    .from('trunk_shows')
    .select('store:trunk_show_stores(state)')
    .eq('id', row.trunk_show_id)
    .maybeSingle()
  const store = Array.isArray((ts as any)?.store) ? (ts as any).store[0] : (ts as any)?.store
  const tz = tzForState(store?.state || null)
  const utc = nineAmInTz(newDate, tz)
  if (utc.getTime() < Date.now() - 60_000) {
    return NextResponse.json({ error: `That date already passed in ${tz}.` }, { status: 400 })
  }

  const { error } = await sb
    .from('communication_sends')
    .update({ scheduled_for: utc.toISOString() })
    .eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, scheduled_for: utc.toISOString(), timezone: tz })
}
