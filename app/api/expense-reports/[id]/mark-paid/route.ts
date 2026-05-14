// POST /api/expense-reports/[id]/mark-paid
//
// Body (optional): { paid_note?: string }
//
// Transitions an approved report to paid. Per spec: "approved → partner
// or user marks 'Paid' → paid". Allows the report owner, a partner, or
// an accounting user (AP records the payment).
//
// paid_note is a free-text 'how was it paid' annotation
// ("Check #1234", "Wire 5/14", "Zelle to 330-555-0101", etc.) that
// surfaces on the Accounting Hub detail panel for paid reports. It is
// stored verbatim — no parsing. Cleared on unmark-paid.

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
    .from('expense_reports').select('id, user_id, status').eq('id', params.id).maybeSingle()
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
  if (report.status !== 'approved') {
    return NextResponse.json(
      { error: `Report is ${report.status}, not approved` },
      { status: 409 },
    )
  }

  // Optional paid_note from the body. Trim + clamp to a reasonable
  // length so an over-eager paste can't bloat the row.
  let paidNote: string | null = null
  try {
    const body = await req.json().catch(() => ({}))
    if (typeof body?.paid_note === 'string') {
      const trimmed = body.paid_note.trim().slice(0, 500)
      paidNote = trimmed.length > 0 ? trimmed : null
    }
  } catch { /* empty body is fine — paid_note stays null */ }

  const { error: upErr } = await sb.from('expense_reports')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      paid_by: me.id,
      paid_note: paidNote,
    })
    .eq('id', params.id)
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, paid: true, paid_note: paidNote })
}
