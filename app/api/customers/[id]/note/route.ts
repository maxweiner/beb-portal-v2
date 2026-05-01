// POST /api/customers/[id]/note
//
// Body: { content: string }
//
// Buyer-callable note-append. Inserts a customer_events row of type
// 'note_added' against the given customer. Buyers can only call this
// when they are listed in events.workers for an event at the
// customer's store and today is in that event's 3-day window.
// Admins / superadmins can always call it.
//
// Notes are append-only via this path — the existing notes column on
// customers is admin-edited via direct update; buyer notes live as
// timeline events to preserve author + timestamp.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser, isAdminLike } from '@/lib/expenses/serverAuth'

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

  let body: any
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const content = (body?.content || '').toString().trim()
  if (!content) return NextResponse.json({ error: 'content required' }, { status: 400 })
  if (content.length > 4000) return NextResponse.json({ error: 'content too long (max 4000 chars)' }, { status: 400 })

  const sb = admin()
  const { data: customer } = await sb.from('customers')
    .select('id, store_id, deleted_at').eq('id', params.id).maybeSingle()
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  if (customer.deleted_at) return NextResponse.json({ error: 'Customer is in trash' }, { status: 409 })

  // Authorization: admin OR buyer with active event window at the
  // customer's store. Phase 1's SQL helper resolves via auth.uid()
  // — meaningless under the service-role client we use server-side.
  // Check inline by querying events directly with the actor's id.
  if (!isAdminLike(me)) {
    const { data: events } = await sb.from('events')
      .select('id, start_date, workers')
      .eq('store_id', customer.store_id)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const inWindow = ((events ?? []) as { start_date: string; workers: any[] }[]).some(e => {
      if (!e.start_date) return false
      const start = new Date(e.start_date + 'T00:00:00')
      const end = new Date(start); end.setDate(start.getDate() + 2); end.setHours(23, 59, 59, 999)
      if (today < start || today > end) return false
      return Array.isArray(e.workers) && e.workers.some(w => w?.id === me.id)
    })
    if (!inWindow) {
      return NextResponse.json({ error: 'Not authorized to add notes for this customer.' }, { status: 403 })
    }
  }

  const { error } = await sb.from('customer_events').insert({
    customer_id: customer.id,
    event_type: 'note_added',
    actor_id: me.id,
    description: content.slice(0, 4000),
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
