// POST /api/expense-reports/[id]/approve
//
// Partner-only state transition: submitted_pending_review → approved.
// On success, fires the accountant email (PR3's
// sendAccountantEmailForReport reuses its PDF generator) and stamps
// approved_at + approved_by.
//
// Partners can approve their own reports per spec ("Any partner can
// approve any report (including their own)"). No is_admin requirement
// — partner is the gating role for approvals.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { sendAccountantEmailForReport } from '@/lib/expenses/sendAccountantEmail'
import { nextBusinessHoursMomentEt } from '@/lib/expenses/quietHours'

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
  if (!me.is_partner) {
    return NextResponse.json({ error: 'Only partners can approve reports' }, { status: 403 })
  }

  const sb = admin()
  const { data: report, error: rErr } = await sb
    .from('expense_reports').select('id, status').eq('id', params.id).maybeSingle()
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 })
  if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (report.status !== 'submitted_pending_review') {
    return NextResponse.json(
      { error: `Report is ${report.status}, not awaiting review` },
      { status: 409 },
    )
  }

  // 1. Flip the state first so the UI reflects approval even if the
  //    accountant email subsequently fails (we surface the error
  //    separately and the user can retry the send manually).
  const { error: upErr } = await sb.from('expense_reports')
    .update({
      status: 'approved',
      approved_at: new Date().toISOString(),
      approved_by: me.id,
    })
    .eq('id', params.id)
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  // 2. Fire the accountant email — but only if we're inside business
  //    hours (Mon-Fri 7am-9pm ET, where the accountant lives). Outside
  //    that window we stamp accountant_email_send_after with the next
  //    business-hours moment, and /api/cron/expense-quiet-hours-flush
  //    picks it up later.
  const portalBaseUrl =
    process.env.NEXT_PUBLIC_BOOKING_BASE_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || 'https://beb-portal-v2.vercel.app'

  const deferUntil = nextBusinessHoursMomentEt()
  if (deferUntil) {
    await sb.from('expense_reports')
      .update({ accountant_email_send_after: deferUntil.toISOString() })
      .eq('id', params.id)
    return NextResponse.json({
      ok: true,
      approved: true,
      email: { ok: true, deferred: true, sendAfter: deferUntil.toISOString() },
    })
  }

  let emailResult
  try {
    emailResult = await sendAccountantEmailForReport(params.id, { portalBaseUrl })
  } catch (err: any) {
    return NextResponse.json({
      ok: true,
      approved: true,
      emailWarning: err?.message ?? 'Could not send accountant email',
    })
  }

  return NextResponse.json({ ok: true, approved: true, email: emailResult })
}
