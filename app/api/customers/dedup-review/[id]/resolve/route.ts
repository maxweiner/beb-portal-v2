// POST /api/customers/dedup-review/[id]/resolve
//
// Body: { action: 'merge' | 'keep_separate' | 'dismiss' }
//
// merge:         applies incoming_data onto existing_customer (only
//                non-null fields), marks queue row as 'merged'.
// keep_separate: inserts a fresh customers row from incoming_data
//                (same store as existing), marks queue row as
//                'kept_separate'.
// dismiss:       drops the incoming data, marks queue row as
//                'dismissed'. The existing customer is unchanged.
//
// Admin-only.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser, isAdminLike } from '@/lib/expenses/serverAuth'
import { blockIfImpersonating } from '@/lib/impersonation/server'

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
  if (!isAdminLike(me)) return NextResponse.json({ error: 'Admin required' }, { status: 403 })

  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  let body: any
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const action = body?.action as 'merge' | 'keep_separate' | 'dismiss'
  if (!['merge', 'keep_separate', 'dismiss'].includes(action)) {
    return NextResponse.json({ error: 'action must be merge, keep_separate, or dismiss' }, { status: 400 })
  }

  const sb = admin()
  const { data: q, error: qErr } = await sb.from('customer_dedup_review_queue')
    .select('*').eq('id', params.id).maybeSingle()
  if (qErr || !q) return NextResponse.json({ error: qErr?.message || 'Not found' }, { status: 404 })
  if (q.status !== 'pending') {
    return NextResponse.json({ error: `Already resolved (${q.status})` }, { status: 409 })
  }

  // Pull existing for store_id (need it for keep_separate insert)
  const { data: existing } = await sb.from('customers')
    .select('id, store_id').eq('id', q.existing_customer_id).maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Existing customer no longer exists' }, { status: 404 })

  const incoming = q.incoming_data as Record<string, unknown>

  if (action === 'merge') {
    const updates: Record<string, unknown> = {
      address_line_1: incoming.address_line_1 ?? undefined,
      address_line_2: incoming.address_line_2 ?? undefined,
      city: incoming.city ?? undefined,
      state: incoming.state ?? undefined,
      zip: incoming.zip ?? undefined,
      phone: incoming.phone ?? undefined,
      email: incoming.email ?? undefined,
      date_of_birth: incoming.date_of_birth ?? undefined,
      how_did_you_hear_legacy: incoming.how_did_you_hear_legacy ?? undefined,
      notes: incoming.notes ?? undefined,
      last_contact_date: incoming.last_contact_date ?? undefined,
      do_not_contact: incoming.do_not_contact || undefined,
    }
    const cleaned: Record<string, unknown> = {}
    for (const k of Object.keys(updates)) if (updates[k] !== undefined) cleaned[k] = updates[k]
    if (Object.keys(cleaned).length > 0) {
      const { error } = await sb.from('customers').update(cleaned).eq('id', existing.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
  } else if (action === 'keep_separate') {
    const { error } = await sb.from('customers').insert({
      store_id: existing.store_id,
      first_name: incoming.first_name,
      last_name: incoming.last_name,
      address_line_1: incoming.address_line_1 ?? null,
      address_line_2: incoming.address_line_2 ?? null,
      city: incoming.city ?? null,
      state: incoming.state ?? null,
      zip: incoming.zip ?? null,
      phone: incoming.phone ?? null,
      email: incoming.email ?? null,
      date_of_birth: incoming.date_of_birth ?? null,
      how_did_you_hear_legacy: incoming.how_did_you_hear_legacy ?? null,
      notes: incoming.notes ?? null,
      last_contact_date: incoming.last_contact_date ?? null,
      do_not_contact: !!incoming.do_not_contact,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  // 'dismiss' just resolves with no data change.

  const newStatus = action === 'merge' ? 'merged'
                  : action === 'keep_separate' ? 'kept_separate'
                  : 'dismissed'
  await sb.from('customer_dedup_review_queue').update({
    status: newStatus,
    resolved_by: me.id,
    resolved_at: new Date().toISOString(),
  }).eq('id', q.id)

  return NextResponse.json({ ok: true, newStatus })
}
