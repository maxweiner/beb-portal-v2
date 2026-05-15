// POST /api/accounting-hub/bulk-paid
//
// Body: {
//   ids:             string[],
//   notify?:         boolean,
//   paid_note?:      string,
//   payment_method?: string   // defaults to 'check'
// }
//
// Marks every listed report as paid IN FULL via the partial-payment
// ledger (one expense_report_payments row per report, amount =
// remaining balance, method shared across the batch). Reports must
// be in 'approved' OR 'partially_paid' status.
//
// paid_note is shared across every report in the batch — typically
// "Check run 5/14", "Wire batch 2026-05-14", etc. Per-report adjustments
// can still happen individually via /api/expense-reports/[id]/payments.
//
// Auth: accounting / admin / superadmin / partner.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { sendEmail } from '@/lib/email'
import { fmtMoney } from '@/lib/format'
import { blockIfImpersonating } from '@/lib/impersonation/server'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch] as string))
}

export async function POST(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  const sb = admin()
  const { data: caller } = await sb
    .from('users')
    .select('role, is_partner, name')
    .eq('id', me.id)
    .maybeSingle()
  const allowed = caller?.role === 'accounting'
    || caller?.role === 'admin'
    || caller?.role === 'superadmin'
    || !!caller?.is_partner
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const ids: unknown = body?.ids
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'No report ids' }, { status: 400 })
  }
  const cleanIds = (ids as any[]).filter((x): x is string => typeof x === 'string' && x.length > 0)
  if (cleanIds.length === 0) return NextResponse.json({ error: 'No valid ids' }, { status: 400 })
  const notify = body?.notify !== false   // default true

  // Shared paid_note for the whole batch. Trim + clamp to 500 chars
  // so a runaway paste can't bloat the rows.
  let paidNote: string | null = null
  if (typeof body?.paid_note === 'string') {
    const trimmed = body.paid_note.trim().slice(0, 500)
    paidNote = trimmed.length > 0 ? trimmed : null
  }

  // Shared payment_method (lowercased canonical form).
  let paymentMethod = 'check'
  if (typeof body?.payment_method === 'string') {
    const m = body.payment_method.toLowerCase().trim()
    if (m.length > 0 && m.length <= 50) paymentMethod = m
  }

  // Pull each report so we can validate status + collect submitter
  // emails for the optional notification.
  const { data: reports, error: fetchErr } = await sb
    .from('expense_reports')
    .select(`
      id, status, user_id, grand_total, amount_paid_cached,
      user:users!user_id(name, email),
      event:events(store_name, start_date)
    `)
    .in('id', cleanIds)
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })

  const eligible: any[] = []
  const skipped: { id: string; reason: string }[] = []
  for (const r of (reports || [])) {
    if (r.status !== 'approved' && r.status !== 'partially_paid') {
      skipped.push({ id: r.id, reason: `status is ${r.status}, not approved or partially paid` })
      continue
    }
    eligible.push(r)
  }

  if (eligible.length === 0) {
    return NextResponse.json({ ok: true, paid: 0, skipped, emails_sent: 0, emails_failed: 0 })
  }

  // Insert one payment row per eligible report. Amount =
  // remaining balance (grand_total minus what's already been
  // paid). The recompute trigger handles status + cache updates.
  // Reports with no remaining balance are silently skipped.
  const paymentRows = eligible
    .map(r => {
      const remaining = Math.max(
        0,
        Number(r.grand_total || 0) - Number(r.amount_paid_cached || 0),
      )
      if (remaining <= 0) return null
      return {
        expense_report_id: r.id,
        amount: Math.round(remaining * 100) / 100,
        payment_method: paymentMethod,
        reference_note: paidNote,
        paid_by: me.id,
      }
    })
    .filter(Boolean)
  if (paymentRows.length === 0) {
    return NextResponse.json({ ok: true, paid: 0, skipped, emails_sent: 0, emails_failed: 0 })
  }
  const { error: insErr } = await sb
    .from('expense_report_payments')
    .insert(paymentRows as any[])
  if (insErr) return NextResponse.json({ error: `Payment insert failed: ${insErr.message}` }, { status: 500 })

  const eligibleIds = paymentRows.map((p: any) => p.expense_report_id)

  // Optional email — one per submitter.
  let emailsSent = 0
  let emailsFailed = 0
  if (notify) {
    const senderName = caller?.name || 'BEB Accounting'
    for (const r of eligible) {
      const to = r.user?.email
      if (!to || typeof to !== 'string' || !to.includes('@')) continue
      const eventLabel = r.event
        ? `${r.event.store_name}${r.event.start_date ? ' (' + r.event.start_date + ')' : ''}`
        : 'your event'
      const html = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a16;max-width:560px;margin:0 auto;padding:20px;background:#F5F0E8">
          <div style="background:#1D6B44;color:#fff;font-weight:700;font-size:13px;padding:6px 14px;border-radius:14px;display:inline-block;margin-bottom:14px">
            ✓ Paid
          </div>
          <h2 style="margin:0 0 6px;font-size:18px">Your expense report has been paid</h2>
          <p style="margin:0 0 10px;color:#4A4A42">
            Event: <b>${escapeHtml(eventLabel)}</b><br/>
            Amount: <b>${escapeHtml(fmtMoney(r.grand_total, { cents: true }))}</b>
          </p>
          <p style="margin:0 0 10px;color:#4A4A42">No further action needed on your end.</p>
          <p style="margin:16px 0 0;color:#A8A89A;font-size:12px">
            Sent by ${escapeHtml(senderName)} · Beneficial Estate Buyers
          </p>
        </div>
      `
      try {
        await sendEmail({
          to,
          subject: `✓ Expense report paid — ${eventLabel}`,
          html,
        })
        emailsSent++
      } catch {
        emailsFailed++
      }
    }
  }

  return NextResponse.json({
    ok: true,
    paid: eligibleIds.length,
    skipped,
    emails_sent: emailsSent,
    emails_failed: emailsFailed,
  })
}
