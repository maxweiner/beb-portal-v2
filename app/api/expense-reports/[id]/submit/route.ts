// POST /api/expense-reports/[id]/submit
//
// Transitions an active expense report → submitted_pending_review,
// stamping submitted_at and (if the caller is a delegate rather than
// the owner) submitted_by_user_id. Fires the delegate-submission
// notification (email + SMS to principal) when applicable.
//
// Replaces the previous direct-supabase update inside
// ExpenseReportDetail.submitForReview(). The state change still goes
// through one round-trip — the notification step kicks off after the
// response is returned (the route awaits the email+SMS, which is
// acceptable for a buyer's "Submit" click that already runs an email
// to partners in the next step). If notification cost becomes a UX
// concern we can move it to fire-and-forget after the response.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser, canActOnReport } from '@/lib/expenses/serverAuth'
import { sendDelegateSubmitNotification } from '@/lib/expenses/sendDelegateSubmitNotification'

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
    .from('expense_reports')
    .select('id, user_id, status')
    .eq('id', params.id)
    .maybeSingle()
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 })
  if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // canActOnReport: owner, active delegate of the owner, or admin.
  // The "delegate" classification is the same predicate that gated
  // every mutation through PR 3 — keeps the rule consistent.
  const canAct = await canActOnReport(me, report.user_id)
  if (!canAct) {
    return NextResponse.json(
      { error: 'Only the report owner or an active delegate can submit' },
      { status: 403 },
    )
  }
  if (report.status !== 'active') {
    return NextResponse.json(
      { error: `Report is ${report.status}, can only submit an active report` },
      { status: 409 },
    )
  }

  // Stamp submitted_by_user_id ONLY when the caller is acting as
  // someone else. Self-submissions leave the column NULL so the PDF
  // doesn't render an unnecessary audit line and the notification
  // helper short-circuits cleanly.
  //
  // Admins acting on behalf of the owner (via the admin override in
  // canActOnReport) also stamp themselves here — that's a reasonable
  // audit signal for "the report wasn't submitted by its owner."
  const isDelegated = me.id !== report.user_id
  const now = new Date().toISOString()
  const update: {
    status: 'submitted_pending_review'
    submitted_at: string
    submitted_by_user_id?: string
  } = {
    status: 'submitted_pending_review',
    submitted_at: now,
  }
  if (isDelegated) update.submitted_by_user_id = me.id

  const { error: upErr } = await sb
    .from('expense_reports')
    .update(update)
    .eq('id', params.id)
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  // Fire the principal notification (email + SMS). Best-effort —
  // failure here is non-fatal since the state transition has already
  // committed. Self-submissions skip this path entirely.
  let notification: Awaited<ReturnType<typeof sendDelegateSubmitNotification>> | null = null
  if (isDelegated) {
    try {
      notification = await sendDelegateSubmitNotification(params.id)
    } catch (err) {
      notification = {
        emailOk: false,
        emailError: err instanceof Error ? err.message : 'unknown',
        smsOk: false,
        smsError: err instanceof Error ? err.message : 'unknown',
      }
    }
  }

  return NextResponse.json({
    ok: true,
    submitted_at: now,
    submitted_by_user_id: isDelegated ? me.id : null,
    notification,
  })
}
