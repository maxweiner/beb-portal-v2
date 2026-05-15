// DELETE /api/expense-reports/[id]/payments/[paymentId]
//
// Soft-deletes a payment ledger row (stamps deleted_at = now()).
// The recompute trigger then drops it from the sum, which can
// push the report's status from 'paid' back to 'partially_paid'
// or all the way to 'approved' depending on what's left.
//
// Auth: accounting / admin / superadmin / partner.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { blockIfImpersonating } from '@/lib/impersonation/server'

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = new Set(['accounting', 'admin', 'superadmin'])

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

function isAllowed(me: any): boolean {
  return ALLOWED_ROLES.has(me?.role) || !!me?.is_partner
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string; paymentId: string } },
) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAllowed(me)) return NextResponse.json({ error: 'Accounting / admin / partner only' }, { status: 403 })

  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  const sb = admin()

  // Verify the row exists, belongs to this report, and isn't
  // already soft-deleted.
  const { data: existing } = await sb
    .from('expense_report_payments')
    .select('id, expense_report_id, deleted_at')
    .eq('id', params.paymentId)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
  if ((existing as any).expense_report_id !== params.id) {
    return NextResponse.json({ error: 'Payment does not belong to this report' }, { status: 400 })
  }
  if ((existing as any).deleted_at) {
    return NextResponse.json({ error: 'Payment already undone' }, { status: 409 })
  }

  const { error } = await sb
    .from('expense_report_payments')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', params.paymentId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Surface the updated report so the UI can refresh in one trip.
  const { data: refreshed } = await sb
    .from('expense_reports')
    .select('id, status, amount_paid_cached, grand_total')
    .eq('id', params.id)
    .maybeSingle()

  return NextResponse.json({ ok: true, report: refreshed })
}
