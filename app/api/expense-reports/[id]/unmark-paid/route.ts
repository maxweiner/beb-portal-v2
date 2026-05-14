// POST /api/expense-reports/[id]/unmark-paid
//
// Reverses mark-paid — drops status back to 'approved' and clears
// paid_at / paid_by / paid_note. Use cases:
//   - Accountant marked the wrong report as paid
//   - Payment bounced / got reversed and the report needs to be
//     re-marked when the new payment clears
//   - Need to edit the paid_note (re-mark with the corrected note)
//
// Auth mirrors mark-paid: report owner, an active delegate, admin /
// superadmin, partner, or accounting. The owner can unmark their
// own to fix an accidental self-mark, but the accountant is the
// expected actor on a typo / bounce.

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

  const canAct = await canActOnReport(me, report.user_id)
  const isAccounting = me.role === 'accounting'
  if (!canAct && !me.is_partner && !isAccounting) {
    return NextResponse.json(
      { error: 'Only partners, accounting, the report owner, or an active delegate can unmark paid' },
      { status: 403 },
    )
  }
  if (report.status !== 'paid') {
    return NextResponse.json(
      { error: `Report is ${report.status}, not paid` },
      { status: 409 },
    )
  }

  const { error: upErr } = await sb.from('expense_reports')
    .update({
      status: 'approved',
      paid_at: null,
      paid_by: null,
      paid_note: null,
    })
    .eq('id', params.id)
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, unpaid: true })
}
