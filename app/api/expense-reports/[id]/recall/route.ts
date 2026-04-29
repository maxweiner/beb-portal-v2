// POST /api/expense-reports/[id]/recall
//
// Owner-only: pulls a submitted-but-not-yet-approved report back to
// 'active' so the buyer can edit and re-submit. Clears submitted_at so
// the next submit re-stamps it cleanly.
//
// Cannot recall once status has moved past submitted_pending_review
// (approved or paid is final from the buyer's side; admin handles
// those edge cases via direct DB access).

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

  if (report.user_id !== me.id) {
    return NextResponse.json({ error: 'Only the report owner can recall' }, { status: 403 })
  }
  if (report.status !== 'submitted_pending_review') {
    return NextResponse.json(
      { error: `Report is ${report.status}, can only recall a pending-review report` },
      { status: 409 },
    )
  }

  const { error: upErr } = await sb.from('expense_reports')
    .update({ status: 'active', submitted_at: null })
    .eq('id', params.id)
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, recalled: true })
}
