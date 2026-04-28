// Email all partners (users.is_partner = true, active = true) when a
// buyer submits an expense report for review. Composed inline — no
// notification-system template needed for a one-shot transactional ping.

import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const fmt$ = (n: number | string | null | undefined) => {
  const v = typeof n === 'string' ? parseFloat(n) : (n ?? 0)
  return USD.format(Number.isFinite(v) ? v : 0)
}
const fmtDateLong = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}

export interface NotifyPartnersResult {
  ok: boolean
  recipientCount: number
  reason?: 'no_partners' | 'send_failed'
  error?: string
}

/**
 * Sends a "report submitted for review" email to every partner. Idempotent
 * but not deduped — call once per submission. Returns count of partners
 * we attempted to email.
 */
export async function notifyPartnersOfSubmission(
  reportId: string,
  opts: { portalBaseUrl?: string } = {},
): Promise<NotifyPartnersResult> {
  const sb = admin()

  const { data: report, error: rErr } = await sb
    .from('expense_reports')
    .select('id, user_id, event_id, status, grand_total, total_expenses, total_compensation, submitted_at')
    .eq('id', reportId).maybeSingle()
  if (rErr || !report) throw new Error(rErr?.message ?? 'Report not found')

  const [{ data: event }, { data: owner }, { data: partners }] = await Promise.all([
    sb.from('events').select('store_name, start_date').eq('id', report.event_id).maybeSingle(),
    sb.from('users').select('name, email').eq('id', report.user_id).maybeSingle(),
    sb.from('users').select('email, name').eq('is_partner', true).eq('active', true),
  ])

  const recipients = (partners ?? [])
    .map((p: any) => p.email)
    .filter((e: any): e is string => typeof e === 'string' && e.length > 0)

  if (recipients.length === 0) {
    return { ok: true, recipientCount: 0, reason: 'no_partners' }
  }

  const buyerName = (owner as any)?.name ?? '(unknown)'
  const eventName = (event as any)?.store_name ?? '(unknown event)'
  const eventDate = (event as any)?.start_date ? fmtDateLong((event as any).start_date) : ''
  const portalLink = opts.portalBaseUrl ? `${opts.portalBaseUrl}/?report=${reportId}` : null

  const subject = `Expense report ready for review — ${buyerName} — ${eventName}`
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1F2937;max-width:560px;">
      <p><strong>${escapeHtml(buyerName)}</strong> submitted an expense report for <strong>${escapeHtml(eventName)}</strong>${eventDate ? ` (${escapeHtml(eventDate)})` : ''}.</p>
      <table style="border-collapse:collapse;font-size:13px;margin-top:14px;">
        <tr>
          <td style="padding:4px 12px 4px 0;color:#6B7280;text-transform:uppercase;font-size:11px;letter-spacing:.04em;">Expenses</td>
          <td style="padding:4px 0;font-weight:700;">${fmt$(report.total_expenses)}</td>
        </tr>
        <tr>
          <td style="padding:4px 12px 4px 0;color:#6B7280;text-transform:uppercase;font-size:11px;letter-spacing:.04em;">Compensation</td>
          <td style="padding:4px 0;font-weight:700;">${fmt$(report.total_compensation)}</td>
        </tr>
        <tr>
          <td style="padding:6px 12px 6px 0;color:#11432B;text-transform:uppercase;font-size:11px;letter-spacing:.04em;border-top:1px solid #E5E7EB;">Grand total</td>
          <td style="padding:6px 0;font-weight:800;color:#11432B;border-top:1px solid #E5E7EB;">${fmt$(report.grand_total)}</td>
        </tr>
      </table>
      ${portalLink ? `<p style="margin-top:18px;"><a href="${portalLink}" style="display:inline-block;background:#1D6B44;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:700;">Open in portal</a></p>` : ''}
      <p style="margin-top:18px;font-size:12px;color:#9CA3AF;">Sent because you're a partner. Approving the report will email the PDF to the accountant.</p>
    </div>
  `.trim()

  let lastErr: string | null = null
  let sent = 0
  for (const to of recipients) {
    try {
      await sendEmail({ to, subject, html })
      sent++
    } catch (err: any) {
      lastErr = err?.message ?? 'unknown error'
    }
  }
  if (sent === 0 && lastErr) return { ok: false, recipientCount: 0, reason: 'send_failed', error: lastErr }
  return { ok: true, recipientCount: sent }
}
