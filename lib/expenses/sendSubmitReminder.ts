// One-off "submit your report" email sent by the daily cron.
//
// Copy is editable from Reports → Templates → Expense Submit Reminder
// (report_templates.id = 'expense-submit-reminder'). Falls back to the
// inline default below if the row is disabled or missing — keeps the
// cron working even before the template editor was wired up.

import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'

const TEMPLATE_ID = 'expense-submit-reminder'

function substitute(s: string, vars: Record<string, string>): string {
  return s.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '')
}

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
  const closingLine = attemptNumber === 3
    ? "This is the final reminder we'll send for this report."
    : "We'll nudge you one more time in 3 days if it's still not submitted."
  const vars: Record<string, string> = {
    buyerName: escapeHtml(buyerName),
    eventName: escapeHtml(eventName),
    eventDate: escapeHtml(eventDate),
    ordinal,
    closingLine: escapeHtml(closingLine),
  }

  // Pull editable copy from report_templates if the admin has enabled it,
  // otherwise use the hard-coded fallback below.
  const { data: tpl } = await sb.from('report_templates')
    .select('subject, greeting, shoutout_fallback, footer, enabled')
    .eq('id', TEMPLATE_ID).maybeSingle()

  const useTpl = tpl && (tpl as any).enabled !== false && ((tpl as any).subject || (tpl as any).shoutout_fallback)
  const subject = useTpl
    ? substitute((tpl as any).subject || `${ordinal}: please submit your expense report — ${eventName}`, vars)
    : `${ordinal}: please submit your expense report — ${eventName}`

  const greetingHtml = useTpl
    ? `<p>${substitute((tpl as any).greeting || 'Hi {{buyerName}},', vars)}</p>`
    : `<p>Hi ${vars.buyerName},</p>`
  const bodyHtml = useTpl
    ? `<p>${substitute((tpl as any).shoutout_fallback || '', vars)}</p>`
    : `<p>Your expense report for <strong>${vars.eventName}</strong>${eventDate ? ` (${vars.eventDate})` : ''} is still in <em>active</em> status — please add any remaining receipts and submit it for review.</p>`
  const footerHtml = useTpl
    ? `<p style="margin-top:18px;font-size:12px;color:#9CA3AF;">${substitute((tpl as any).footer || '{{closingLine}}', vars)}</p>`
    : `<p style="margin-top:18px;font-size:12px;color:#9CA3AF;">${vars.closingLine}</p>`

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1F2937;max-width:540px;">
      ${greetingHtml}
      ${bodyHtml}
      ${portalLink ? `<p style="margin-top:18px;"><a href="${portalLink}" style="display:inline-block;background:#1D6B44;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:700;">Open the portal</a></p>` : ''}
      ${footerHtml}
    </div>
  `.trim()

  try {
    await sendEmail({ to, subject, html })
    return { ok: true, recipient: to }
  } catch (err: any) {
    return { ok: false, reason: 'send_failed', error: err?.message ?? 'unknown error' }
  }
}
