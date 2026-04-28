// POST /api/expense-reports/[id]/calculate-mileage
//
// Returns a mileage breakdown for the given report (uses the report
// owner's home_address + the event's store address). Does NOT save
// the expense — the client shows the breakdown for confirmation, then
// inserts the expense itself with source='mileage_calc'.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser, isAdminLike } from '@/lib/expenses/serverAuth'
import { calculateMileageForReport } from '@/lib/expenses/calculateMileage'

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
  if (!isOwner && !isAdminLike(me)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (isOwner && report.status !== 'active') {
    return NextResponse.json({ error: `Report is ${report.status}, no longer editable` }, { status: 409 })
  }

  try {
    const breakdown = await calculateMileageForReport(params.id)
    return NextResponse.json({ ok: true, breakdown })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Mileage calc failed' }, { status: 400 })
  }
}
