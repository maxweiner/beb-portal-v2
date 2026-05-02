// POST /api/customers/[id]/forget
//
// Initiates the right-to-be-forgotten flow:
//   1. Soft-deletes the customer (deleted_at = now).
//   2. Records a compliance_actions row of type
//      'right_to_be_forgotten_initiated' with meta.scheduled_finalize_at
//      = now + grace_days (default 7).
//
// The daily customers-compliance cron picks up the row when its
// scheduled finalize date passes and hard-deletes (cascade removes
// tags + mailings + events). The compliance_actions row stays
// forever — it's the legal record. Email + name snapshots are
// captured here so the record stays interpretable after hard-delete.
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

  const sb = admin()
  const { data: customer } = await sb.from('customers')
    .select('id, store_id, first_name, last_name, email')
    .eq('id', params.id).maybeSingle()
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  // Read configurable grace period
  const { data: graceRow } = await sb.from('settings').select('value')
    .eq('key', 'customers.rtf_grace_days').maybeSingle()
  let graceDays = 7
  const gv = (graceRow as any)?.value
  if (typeof gv === 'number') graceDays = gv
  else if (typeof gv === 'string') {
    const n = parseInt(gv.replace(/^"|"$/g, ''), 10)
    if (Number.isFinite(n) && n > 0) graceDays = n
  }
  const finalizeAt = new Date(Date.now() + graceDays * 86_400_000).toISOString()

  // Soft-delete + log compliance action atomically (best-effort —
  // both are quick non-conflicting writes).
  const nowIso = new Date().toISOString()
  const { error: delErr } = await sb.from('customers')
    .update({ deleted_at: nowIso }).eq('id', customer.id)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  await sb.from('compliance_actions').insert({
    customer_id: customer.id,
    store_id: customer.store_id,
    customer_email_snapshot: customer.email,
    customer_name_snapshot: `${customer.first_name} ${customer.last_name}`.trim(),
    action: 'right_to_be_forgotten_initiated',
    initiated_by: me.id,
    meta: { scheduled_finalize_at: finalizeAt, grace_days: graceDays },
  })

  return NextResponse.json({ ok: true, scheduled_finalize_at: finalizeAt })
}
