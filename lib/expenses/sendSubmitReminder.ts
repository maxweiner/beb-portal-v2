// One-off "submit your report" email sent by the daily cron. Composed
// inline (Resend transactional, no notification-system template needed
// — same pattern as notifyPartnersOfSubmission).

import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

const fmtDateLong = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}

export interface SubmitReminderResult {
  ok: boolean
  recipient?: string | null
  reason?: 'no_email' | 'send_failed'
  error?: string
}

/**
 * Sends one reminder. Caller (the cron) handles eligibility filtering
 * and stamps reminder_count + last_reminder_sent_at on success.
 */
export async function sendSubmitReminderForReport(
  reportId: string,
  attemptNumber: number,
  opts: { portalBaseUrl?: string } = {},
): Promise<SubmitReminderResult> {
  const sb = admin()

  const { data: report, error: rErr } = await sb
    .from('expense_reports')
    .select('id, user_id, event_id')
    .eq('id', reportId).maybeSingle()
  if (rErr || !report) throw new Error(rErr?.message ?? 'Report not found')

  const [{ data: event }, { data: owner }] = await Promise.all([
    sb.from('events').select('store_name, start_date').eq('id', report.event_id).maybeSingle(),
    sb.from('users').select('name, email').eq('id', report.user_id).maybeSingle(),
  ])
  const to = (owner as any)?.email as string | undefined
  if (!to) return { ok: false, reason: 'no_email' }

  const buyerName = (owner as any)?.name ?? 'there'
  const eventName = (event as any)?.store_name ?? 'your event'
  const eventDate = (event as any)?.start_date ? fmtDateLong((event as any).start_date) : ''
  // Deep-link directly to this report (matches notifyPartners +
  // sendAccountantEmail). app/page.tsx reads the `?report=` param and
  // opens the Expenses tab pre-pointed at it.
  const portalLink = opts.portalBaseUrl ? `${opts.portalBaseUrl}/?report=${reportId}` : null

  const ordinal = attemptNumber === 1 ? 'Reminder' : attemptNumber === 2 ? 'Second reminder' : 'Final reminder'
  const subject = `${ordinal}: please submit your expense report — ${eventName}`
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1F2937;max-width:540px;">
      <p>Hi ${escapeHtml(buyerName)},</p>
      <p>Your expense report for <strong>${escapeHtml(eventName)}</strong>${eventDate ? ` (${escapeHtml(eventDate)})` : ''} is still in <em>active</em> status — please add any remaining receipts and submit it for review.</p>
      ${portalLink ? `<p style="margin-top:18px;"><a href="${portalLink}" style="display:inline-block;background:#1D6B44;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:700;">Open the portal</a></p>` : ''}
      <p style="margin-top:18px;font-size:12px;color:#9CA3AF;">${attemptNumber === 3 ? 'This is the final reminder we\'ll send for this report.' : 'We\'ll nudge you one more time in 3 days if it\'s still not submitted.'}</p>
    </div>
  `.trim()

  try {
    await sendEmail({ to, subject, html })
    return { ok: true, recipient: to }
  } catch (err: any) {
    return { ok: false, reason: 'send_failed', error: err?.message ?? 'unknown error' }
  }
}
