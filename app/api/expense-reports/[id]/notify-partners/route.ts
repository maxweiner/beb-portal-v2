// POST /api/expense-reports/[id]/notify-partners
//
// Fired by the client right after a submit-for-review transition.
// Server re-verifies the report is in submitted_pending_review state
// (so a malicious caller can't spam partners with arbitrary reports)
// and sends the partner alert email.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser, isAdminLike } from '@/lib/expenses/serverAuth'
import { notifyPartnersOfSubmission } from '@/lib/expenses/notifyPartners'

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

  // Only the report owner or an admin/superadmin can trigger the alert.
  if (report.user_id !== me.id && !isAdminLike(me)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (report.status !== 'submitted_pending_review') {
    return NextResponse.json({ error: 'Report is not awaiting review' }, { status: 409 })
  }

  const url = new URL(req.url)
  const portalBaseUrl = `${url.protocol}//${url.host}`
  try {
    const result = await notifyPartnersOfSubmission(params.id, { portalBaseUrl })
    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Notify failed' }, { status: 500 })
  }
}
