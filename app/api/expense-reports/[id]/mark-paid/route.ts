// POST /api/expense-reports/[id]/mark-paid
//
// Transitions an approved report to paid. Per spec: "approved → partner
// or user marks 'Paid' → paid". Allows the report owner, a partner, or
// an accounting user (AP records the payment).

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
  const { data: report, error: rErr } = await sb
    .from('expense_reports').select('id, user_id, status').eq('id', params.id).maybeSingle()
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 })
  if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const isOwner = report.user_id === me.id
  const isAccounting = me.role === 'accounting'
  if (!isOwner && !me.is_partner && !isAccounting) {
    return NextResponse.json(
      { error: 'Only partners, accounting, or the report owner can mark paid' },
      { status: 403 },
    )
  }
  if (report.status !== 'approved') {
    return NextResponse.json(
      { error: `Report is ${report.status}, not approved` },
      { status: 409 },
    )
  }

  const { error: upErr } = await sb.from('expense_reports')
    .update({ status: 'paid', paid_at: new Date().toISOString(), paid_by: me.id })
    .eq('id', params.id)
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, paid: true })
}
