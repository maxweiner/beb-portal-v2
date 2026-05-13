// Notifies the principal (Alan) when their delegate (Ryan) submits
// an expense report on their behalf.
//
// Fires email + SMS in parallel. Both are best-effort — the
// submission state-transition is already committed by the time
// this runs, so a failure here surfaces a soft warning rather
// than rolling back the submit.
//
// SMS is a no-op when no Twilio config is set (see lib/sms.ts).
// Today (2026-05-13) the toll-free +18662714988 is IN_REVIEW with
// Twilio, so the SMS path is wired but won't actually deliver
// until that approval lands. When it does, no code change here
// is needed — just swap the fromNumber in settings.value.fromNumber.
//
// Copy lock per the spec (no template editor for this one;
// audit-driven feature shouldn't have editable copy):
//
//   Email subject:
//     "Ryan submitted an expense report for you — $182.50"
//
//   Email body:
//     Hi Alan,
//     Ryan Smith just submitted a $182.50 expense report on your
//     behalf. It's been forwarded to BEB accounting for processing.
//     [event/receipt context]
//     If you have questions, contact Ryan or BEB Accounting directly.
//     You don't need to log in or take action.
//
//   SMS body:
//     Ryan submitted a $182.50 expense report on your behalf
//     (3 receipts, Atlanta trip). Forwarded to accounting. Contact
//     Ryan with questions. — BEB

import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'
import { sendSMS } from '@/lib/sms'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

const fmtMoney = (n: number) =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}

export interface DelegateSubmitNotificationResult {
  emailOk: boolean
  emailError?: string
  smsOk: boolean
  smsError?: string
  /** Set when the principal has no email at all (skipped, not failed). */
  emailSkipReason?: 'no_email'
  /** Set when the principal has no phone (skipped, not failed). */
  smsSkipReason?: 'no_phone'
}

/**
 * Send email + SMS to the principal letting them know a delegate
 * submitted on their behalf. Caller is responsible for verifying
 * the delegation context (submitted_by_user_id is set + the
 * report is in submitted_pending_review). Both transports run in
 * parallel; the function never throws — failures are returned in
 * the result object.
 */
export async function sendDelegateSubmitNotification(
  reportId: string,
): Promise<DelegateSubmitNotificationResult> {
  const sb = admin()

  // Load the data this notification needs in a single round-trip.
  const { data: report, error: rErr } = await sb
    .from('expense_reports')
    .select('id, user_id, event_id, submitted_by_user_id, grand_total')
    .eq('id', reportId)
    .maybeSingle()
  if (rErr || !report || !report.submitted_by_user_id) {
    // Caller passed a self-submitted report — nothing to notify.
    return {
      emailOk: false,
      emailError: 'Report not delegated or not found',
      smsOk: false,
      smsError: 'Report not delegated or not found',
    }
  }

  const [{ data: principal }, { data: delegate }, { data: event }, { count: receiptCount }] = await Promise.all([
    sb.from('users').select('name, email, phone, notify_sms').eq('id', report.user_id).maybeSingle(),
    sb.from('users').select('name').eq('id', report.submitted_by_user_id).maybeSingle(),
    report.event_id
      ? sb.from('events').select('store_name, store_city, store_state, start_date').eq('id', report.event_id).maybeSingle()
      : Promise.resolve({ data: null } as { data: null }),
    sb.from('expenses').select('id', { count: 'exact', head: true }).eq('expense_report_id', reportId).not('receipt_url', 'is', null),
  ])

  const delegateName = (delegate as { name?: string } | null)?.name || 'A delegate'
  const principalName = (principal as { name?: string } | null)?.name || 'there'
  const principalEmail = (principal as { email?: string } | null)?.email || ''
  const principalPhone = (principal as { phone?: string } | null)?.phone || ''
  const principalSmsOptIn = (principal as { notify_sms?: boolean } | null)?.notify_sms !== false
  const grandTotal = Number(report.grand_total || 0)
  const totalStr = fmtMoney(grandTotal)
  const receipts = receiptCount || 0
  const eventLabel = event
    ? `${(event as { store_name?: string }).store_name || 'event'}${
        (event as { store_city?: string }).store_city
          ? ` (${(event as { store_city?: string }).store_city}${
              (event as { store_state?: string }).store_state ? ', ' + (event as { store_state?: string }).store_state : ''
            })`
          : ''
      }`
    : null

  const result: DelegateSubmitNotificationResult = { emailOk: false, smsOk: false }

  // ── Email ────────────────────────────────────────────────────
  if (!principalEmail) {
    result.emailSkipReason = 'no_email'
  } else {
    const subject = `${delegateName.split(' ')[0]} submitted an expense report for you — ${totalStr}`
    const eventLine = eventLabel
      ? `<p style="margin:8px 0;">Event: <strong>${escapeHtml(eventLabel)}</strong>${
          receipts > 0 ? ` · ${receipts} receipt${receipts === 1 ? '' : 's'}` : ''
        }</p>`
      : ''
    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1F2937;max-width:540px;line-height:1.5;">
        <p>Hi ${escapeHtml(principalName)},</p>
        <p><strong>${escapeHtml(delegateName)}</strong> just submitted a <strong>${escapeHtml(totalStr)}</strong> expense report on your behalf. It's been forwarded to BEB accounting for processing.</p>
        ${eventLine}
        <p>If you have questions, contact ${escapeHtml(delegateName)} or BEB Accounting directly. You don't need to log in or take action.</p>
        <p style="margin-top:18px;font-size:12px;color:#9CA3AF;">— BEB</p>
      </div>
    `.trim()
    try {
      await sendEmail({ to: principalEmail, subject, html })
      result.emailOk = true
    } catch (err) {
      result.emailError = err instanceof Error ? err.message : 'send_failed'
    }
  }

  // ── SMS ──────────────────────────────────────────────────────
  // Respect the user's SMS opt-in (notify_sms !== false). Toll-free
  // +18662714988 is currently IN_REVIEW with Twilio; once approved,
  // sendSMS() will start delivering — no code change here.
  if (!principalPhone || !principalSmsOptIn) {
    result.smsSkipReason = 'no_phone'
  } else {
    const receiptFragment = receipts > 0 ? `, ${receipts} receipt${receipts === 1 ? '' : 's'}` : ''
    const eventFragment = eventLabel ? `, ${eventLabel}` : ''
    const body = `${delegateName.split(' ')[0]} submitted a ${totalStr} expense report on your behalf (${eventLabel || 'event'}${receiptFragment}). Forwarded to accounting. Contact ${delegateName.split(' ')[0]} with questions. — BEB`.replace(/\s+/g, ' ').trim()
    // The () pair around eventLabel is ugly when eventLabel is null —
    // strip the redundancy in that case.
    const finalBody = !eventLabel && !receiptFragment
      ? `${delegateName.split(' ')[0]} submitted a ${totalStr} expense report on your behalf. Forwarded to accounting. Contact ${delegateName.split(' ')[0]} with questions. — BEB`
      : body
    try {
      await sendSMS(principalPhone, finalBody)
      result.smsOk = true
    } catch (err) {
      result.smsError = err instanceof Error ? err.message : 'send_failed'
    }
  }

  return result
}
