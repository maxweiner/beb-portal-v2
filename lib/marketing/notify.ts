// Shared helpers for marketing email notifications. Keeps the per-
// route handlers thin and consistent — every approver-notification
// email looks the same and applies the marketing-* report template.

import { sendEmail } from '@/lib/email'

interface SbClient { from: (table: string) => any; auth: any; storage: any }

export interface ApproverEmailVars {
  store_name: string
  date_range: string
  flow_type: string
  campaign_url: string
  // optional extras per template
  budget_amount?: string
  version_number?: string | number
  /** Index signature so this struct is assignable to substituteVars's
   *  Record<string, …> param. */
  [k: string]: string | number | null | undefined
}

export function substituteVars(text: string, vars: Record<string, string | number | null | undefined>): string {
  return (text || '').replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars[k]
    return v == null ? '' : String(v)
  })
}

export function escapeHtml(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function renderApproverEmailHtml(opts: {
  greeting: string; subtitle: string; body: string; ctaUrl: string; ctaLabel: string; footer: string
}): string {
  const bodyHtml = (opts.body || '').replace(/\n/g, '<br/>')
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #f5f0e8; padding: 20px;">
      <div style="background: #2D3B2D; padding: 24px; border-radius: 8px 8px 0 0; color: #fff;">
        <div style="color: #7EC8A0; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 4px;">
          Beneficial Estate Buyers · Marketing
        </div>
        <div style="font-size: 20px; font-weight: 900;">${escapeHtml(opts.greeting)}</div>
        <div style="font-size: 13px; color: rgba(255,255,255,.6); margin-top: 4px;">${escapeHtml(opts.subtitle)}</div>
      </div>
      <div style="background: #fff; padding: 24px; border: 1px solid #e8e0d0; border-top: none; font-size: 14px; color: #333; line-height: 1.6;">
        <div>${bodyHtml}</div>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${opts.ctaUrl}" style="display: inline-block; padding: 14px 32px; background: #2D3B2D; color: #fff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
            ${escapeHtml(opts.ctaLabel)} →
          </a>
        </div>
      </div>
      <div style="background: #fff; padding: 14px 28px; border: 1px solid #e8e0d0; border-top: none; border-radius: 0 0 8px 8px; text-align: center; font-size: 12px; color: #a8a89a;">
        ${escapeHtml(opts.footer)}
      </div>
    </div>
  `
}

/**
 * Sends an approver notification (one email per active approver) using
 * the named report_templates row, with var substitution. Returns
 * { sent, failed } counts. Best-effort — caller decides what to do
 * with failed sends.
 */
export async function notifyApprovers(opts: {
  sb: SbClient
  templateId: string
  vars: ApproverEmailVars
  ctaLabel?: string
  /** When set, every email is sent with a Reply-To pointing here.
   *  Used by proof notifications so approvers can reply "approve" and
   *  the inbound webhook can route it back to the right proof. */
  replyTo?: string
}): Promise<{ sent: number; failed: number; errors: string[] }> {
  const errors: string[] = []
  let sent = 0
  let failed = 0

  // Active approvers + their emails
  const { data: approvers } = await opts.sb.from('marketing_approvers')
    .select('user_id, is_active').eq('is_active', true)
  const userIds = ((approvers ?? []) as { user_id: string }[]).map(a => a.user_id)
  if (userIds.length === 0) return { sent, failed, errors: ['No active approvers configured.'] }

  const { data: users } = await opts.sb.from('users').select('email').in('id', userIds)
  const emails = ((users ?? []) as { email: string }[])
    .map(u => u.email)
    .filter((e): e is string => typeof e === 'string' && e.includes('@'))
  if (emails.length === 0) return { sent, failed, errors: ['Approvers have no usable email addresses.'] }

  const { data: tpl } = await opts.sb.from('report_templates')
    .select('subject, greeting, header_subtitle, footer, shoutout_fallback')
    .eq('id', opts.templateId).maybeSingle()

  const subject = substituteVars(tpl?.subject || `${opts.vars.flow_type.toUpperCase()} approval needed: ${opts.vars.store_name}`, opts.vars)
  const greeting = substituteVars(tpl?.greeting || 'Hi team,', opts.vars)
  const subtitle = substituteVars(tpl?.header_subtitle || `${opts.vars.store_name} · ${opts.vars.date_range}`, opts.vars)
  const body = substituteVars(tpl?.shoutout_fallback || 'A campaign needs your review. Open it to approve.', opts.vars)
  const footer = substituteVars(tpl?.footer || 'Beneficial Estate Buyers · Marketing', opts.vars)

  const html = renderApproverEmailHtml({
    greeting, subtitle, body,
    ctaUrl: opts.vars.campaign_url,
    ctaLabel: opts.ctaLabel || 'Open Campaign',
    footer,
  })

  for (const email of emails) {
    try {
      await sendEmail({ to: email, subject, html, replyTo: opts.replyTo })
      sent++
    } catch (err: any) {
      failed++
      errors.push(`${email}: ${err?.message || 'unknown'}`)
    }
  }
  return { sent, failed, errors }
}

export function fmtDateRange(startIso: string): string {
  // 3-day event helper inlined to avoid pulling lib/eventDates server-only logic.
  const start = new Date(startIso + 'T12:00:00')
  const end = new Date(start)
  end.setDate(start.getDate() + 2)
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()
  const startLabel = start.toLocaleDateString('en-US', sameMonth
    ? { month: 'long', day: 'numeric' }
    : { month: 'short', day: 'numeric' })
  const endLabel = end.toLocaleDateString('en-US', { month: sameMonth ? undefined : 'short', day: 'numeric', year: 'numeric' })
  return `${startLabel}–${endLabel}`
}

export function appBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'https://beb-portal-v2.vercel.app'
}
