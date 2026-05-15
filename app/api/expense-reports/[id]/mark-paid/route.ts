// POST /api/expense-reports/[id]/mark-paid
//
// Body (optional): {
//   paid_note?:      string,
//   payment_method?: string,   // 'check' (default) / 'zelle' / 'wire' / 'ach' / custom
// }
//
// Marks a report as paid IN FULL. Internally this writes a single
// expense_report_payments row for the report's grand_total; the
// recompute trigger flips status='paid' + populates paid_at / paid_by
// / paid_note + amount_paid_cached.
//
// Kept as a back-compat shim around the partial-payments work so
// older callers (the Hub's bulk-paid + single-row "Mark Paid"
// button when not using the modal) keep working unchanged.
//
// For partial payments use POST /api/expense-reports/[id]/payments.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser, canActOnReport } from '@/lib/expenses/serverAuth'
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

  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  const sb = admin()
  const { data: report, error: rErr } = await sb
    .from('expense_reports').select('id, user_id, status, grand_total, amount_paid_cached').eq('id', params.id).maybeSingle()
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 })
  if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // canActOnReport returns true for the owner, an active delegate
  // of the owner, or admin/superadmin. Partners and accounting role
  // get their own explicit allow below (they can mark anyone's
  // report paid regardless of ownership).
  const canAct = await canActOnReport(me, report.user_id)
  const isAccounting = me.role === 'accounting'
  if (!canAct && !me.is_partner && !isAccounting) {
    return NextResponse.json(
      { error: 'Only partners, accounting, the report owner, or an active delegate can mark paid' },
      { status: 403 },
    )
  }
  // Allow mark-paid from approved OR partially_paid. The latter
  // is the "pay off the remaining balance" case.
  if (report.status !== 'approved' && report.status !== 'partially_paid') {
    return NextResponse.json(
      { error: `Report is ${report.status}, not approved or partially paid` },
      { status: 409 },
    )
  }

  // Optional paid_note + payment_method from the body.
  let paidNote: string | null = null
  let paymentMethod = 'check'  // sensible default for the legacy callers
  try {
    const body = await req.json().catch(() => ({}))
    if (typeof body?.paid_note === 'string') {
      const trimmed = body.paid_note.trim().slice(0, 500)
      paidNote = trimmed.length > 0 ? trimmed : null
    }
    if (typeof body?.payment_method === 'string') {
      const m = body.payment_method.toLowerCase().trim()
      if (m.length > 0 && m.length <= 50) paymentMethod = m
    }
  } catch { /* empty body is fine */ }

  // Write a single payment row for whatever's still owed. The
  // trigger on expense_report_payments handles the status flip
  // and amount_paid_cached recompute — no manual updates here.
  const remaining = Math.max(
    0,
    Number(report.grand_total || 0) - Number((report as any).amount_paid_cached || 0),
  )
  if (remaining <= 0) {
    // Already fully paid via partial payments. Just flip status.
    return NextResponse.json({ ok: true, paid: true, already_settled: true })
  }

  const { error: insErr } = await sb
    .from('expense_report_payments')
    .insert({
      expense_report_id: params.id,
      amount: Math.round(remaining * 100) / 100,
      payment_method: paymentMethod,
      reference_note: paidNote,
      paid_by: me.id,
    })
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, paid: true, paid_note: paidNote, payment_method: paymentMethod })
}
