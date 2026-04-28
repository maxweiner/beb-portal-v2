// Compose and send the accountant email for an approved expense
// report. Subject + body follow the spec: brief auto-summary plus the
// generated PDF as an attachment. The accountant address is read from
// the settings table at key='accountant_email' (mirrors how the Resend
// API key is stored). Quiet-hours queueing lands in PR13.

import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'
import { generateAndStoreReportPdf, fetchReportPdfBytes } from './generatePdf'

interface ReportSummaryRow {
  id: string
  user_id: string
  event_id: string
  status: string
  total_expenses: number | string
  total_compensation: number | string
  grand_total: number | string
  pdf_url: string | null
  submitted_at: string | null
  approved_at: string | null
}

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

async function loadAccountantEmail(): Promise<string | null> {
  const sb = admin()
  // Prefer the settings-table value (matches how resend_api_key is stored
  // in this codebase). Fall back to ACCOUNTANT_EMAIL env var.
  const { data } = await sb.from('settings').select('value').eq('key', 'accountant_email').maybeSingle()
  const fromSettings = (data as any)?.value as string | undefined
  return fromSettings || process.env.ACCOUNTANT_EMAIL || null
}

export interface SendAccountantEmailResult {
  ok: boolean
  reason?: 'no_accountant_address' | 'send_failed'
  messageId?: string | null
  error?: string
}

/**
 * Generates the PDF (or reuses the existing one), composes a summary
 * email, and sends it to the configured accountant with the PDF
 * attached. Stamps accountant_email_sent_at on success. Idempotent:
 * regenerates the PDF on every call so the attachment always reflects
 * the current report state.
 */
export async function sendAccountantEmailForReport(
  reportId: string,
  opts: { portalBaseUrl?: string } = {},
): Promise<SendAccountantEmailResult> {
  const accountantTo = await loadAccountantEmail()
  if (!accountantTo) return { ok: false, reason: 'no_accountant_address' }

  const sb = admin()
  const { data: report, error: rErr } = await sb
    .from('expense_reports').select('*').eq('id', reportId).maybeSingle()
  if (rErr || !report) throw new Error(rErr?.message ?? 'Report not found')

  // Always regenerate so the attachment matches whatever the report
  // looks like right now (handles the "report was edited after a
  // previous send" case).
  const { pdfPath } = await generateAndStoreReportPdf(reportId)
  const pdfBuffer = await fetchReportPdfBytes(pdfPath)

  const r = report as ReportSummaryRow
  const [{ data: event }, { data: owner }] = await Promise.all([
    sb.from('events').select('store_name, start_date').eq('id', r.event_id).maybeSingle(),
    sb.from('users').select('name, email').eq('id', r.user_id).maybeSingle(),
  ])

  const buyerName  = (owner as any)?.name ?? '(unknown)'
  const eventName  = (event as any)?.store_name ?? '(unknown event)'
  const eventDate  = (event as any)?.start_date ? fmtDateLong((event as any).start_date) : ''
  const portalUrl  = opts.portalBaseUrl ? `${opts.portalBaseUrl}/?report=${reportId}` : null

  const subject = `Expense Report — ${buyerName} — ${eventName}${eventDate ? ` — ${eventDate}` : ''}`

  // Per-category breakdown for the email body.
  const { data: expenses } = await sb.from('expenses')
    .select('category, custom_category_label, amount')
    .eq('expense_report_id', reportId)
  const catTotals = new Map<string, number>()
  for (const e of (expenses ?? []) as any[]) {
    const key = e.category === 'custom' && e.custom_category_label
      ? `Custom: ${e.custom_category_label}`
      : e.category.replace(/_/g, ' ')
    catTotals.set(key, (catTotals.get(key) ?? 0) + Number(e.amount || 0))
  }
  const catRowsHtml = [...catTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `
      <tr>
        <td style="padding:6px 12px;border-bottom:1px solid #E5E7EB;text-transform:capitalize;">${k}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #E5E7EB;text-align:right;font-weight:700;">${fmt$(v)}</td>
      </tr>
    `).join('')

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1F2937;max-width:560px;">
      <p>Attached is the expense report for <strong>${escapeHtml(buyerName)}</strong> for <strong>${escapeHtml(eventName)}</strong>${eventDate ? ` (${escapeHtml(eventDate)})` : ''}.</p>

      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:14px;">
        <thead>
          <tr style="background:#F3EFE6;">
            <th style="padding:6px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#4B5563;">Category</th>
            <th style="padding:6px 12px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#4B5563;">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${catRowsHtml || '<tr><td colspan="2" style="padding:8px 12px;color:#9CA3AF;font-style:italic;">No expenses</td></tr>'}
          <tr>
            <td style="padding:6px 12px;border-top:1px solid #E5E7EB;">Compensation</td>
            <td style="padding:6px 12px;border-top:1px solid #E5E7EB;text-align:right;font-weight:700;">${fmt$(r.total_compensation)}</td>
          </tr>
          <tr style="background:#11432B;color:#fff;">
            <td style="padding:8px 12px;font-weight:700;">Grand total</td>
            <td style="padding:8px 12px;text-align:right;font-weight:700;">${fmt$(r.grand_total)}</td>
          </tr>
        </tbody>
      </table>

      ${portalUrl ? `<p style="margin-top:18px;"><a href="${portalUrl}" style="color:#1D6B44;font-weight:700;">View in portal</a></p>` : ''}
      <p style="margin-top:18px;font-size:12px;color:#9CA3AF;">Report #${r.id.slice(0, 8)} — sent automatically by Beneficial Estate Buyers portal.</p>
    </div>
  `.trim()

  const filename = `expense-report-${buyerName.replace(/\s+/g, '-').toLowerCase()}-${(event as any)?.start_date ?? 'undated'}.pdf`
  let messageId: string | null = null
  try {
    messageId = await sendEmail({
      to: accountantTo,
      subject,
      html,
      attachments: [{ filename, content: pdfBuffer.toString('base64') }],
    })
  } catch (err: any) {
    return { ok: false, reason: 'send_failed', error: err?.message ?? 'unknown error' }
  }

  await sb.from('expense_reports')
    .update({ accountant_email_sent_at: new Date().toISOString() })
    .eq('id', reportId)

  return { ok: true, messageId }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}
