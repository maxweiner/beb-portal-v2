// POST /api/communications/[id]/cancel-schedule
//
// Cancels a pending scheduled send. Only valid while delivery_status
// is still 'scheduled'. Already-sent rows can't be unsent from here.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'

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
  const { data: row } = await sb
    .from('communication_sends')
    .select('id, delivery_status, scheduled_by_user_id, trunk_show_id')
    .eq('id', params.id)
    .maybeSingle()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (row.delivery_status !== 'scheduled') {
    return NextResponse.json({ error: 'Only pending scheduled sends can be cancelled.' }, { status: 400 })
  }

  // Auth: scheduler can cancel their own; admin/superadmin/partner
  // can cancel any.
  const isAdminLike = me.role === 'admin' || me.role === 'superadmin' || !!me.is_partner
  if (!isAdminLike && row.scheduled_by_user_id !== me.id) {
    return NextResponse.json({ error: 'Forbidden — you didn\'t schedule this send.' }, { status: 403 })
  }

  const { error } = await sb
    .from('communication_sends')
    .update({
      delivery_status:      'cancelled',
      cancelled_at:         new Date().toISOString(),
      cancelled_by_user_id: me.id,
    })
    .eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
