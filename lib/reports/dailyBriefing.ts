// Data-assembly + email-render for the Daily Briefing template.
// Used by both /api/daily-report (the existing cron endpoint) and
// /api/cron/process-scheduled-reports (the new dispatcher).
//
// Behavior is intentionally identical to the pre-extraction inline
// HTML in /api/daily-report so the cron output doesn't change.

import { createClient } from '@supabase/supabase-js'

export type Brand = 'beb' | 'liberty'

interface BrandMeta {
  label: string
  fromName: string
  fromEmail: string
  emoji: string
  footer: string
  notifyColumn: 'notify_beb' | 'notify_liberty'
}

export const BRAND_META: Record<Brand, BrandMeta> = {
  beb: {
    label: 'Beneficial Estate Buyers',
    fromName: 'BEB Portal',
    fromEmail: 'noreply@updates.bebllp.com',
    emoji: '🌅',
    footer: 'BEB Buyer Portal · Daily Morning Report',
    notifyColumn: 'notify_beb',
  },
  liberty: {
    label: 'Liberty Estate Buyers',
    fromName: 'Liberty Estate Buyers',
    fromEmail: 'noreply@libertyestatebuyers.com',
    emoji: '🌅',
    footer: 'Liberty Buyer Portal · Daily Morning Report',
    notifyColumn: 'notify_liberty',
  },
}

interface TemplateOverrides {
  subject?: string | null
  greeting?: string | null
  header_subtitle?: string | null
  footer?: string | null
}

interface SendResult {
  brand: Brand
  sent?: number
  events?: number
  skipped?: string
}

function substitute(str: string, vars: Record<string, string>): string {
  return str.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '')
}

/** Look up active recipients for a brand from the legacy notify_* columns. */
export async function fetchLegacyRecipients(brand: Brand): Promise<string[]> {
  const sb = serviceClient()
  const meta = BRAND_META[brand]
  const { data: admins } = await sb.from('users')
    .select('email, alternate_emails')
    .in('role', ['admin', 'superadmin'])
    .eq('active', true)
    .eq(meta.notifyColumn, true)
  return flattenEmails(admins || [])
}

/** Look up recipients for a brand from the new report_template_recipients table. */
export async function fetchTemplateRecipients(templateId: string, brand: Brand): Promise<string[]> {
  const sb = serviceClient()
  const { data } = await sb.from('report_template_recipients')
    .select('users(email, alternate_emails, active)')
    .eq('template_id', templateId)
    .eq('brand', brand)
  const users = (data || [])
    .map((r: any) => r.users)
    .filter((u: any) => u && u.active)
  return flattenEmails(users)
}

function flattenEmails(rows: { email?: string | null; alternate_emails?: string[] | null }[]): string[] {
  const out: string[] = []
  for (const r of rows) {
    if (r.email) out.push(r.email)
    if (r.alternate_emails) out.push(...r.alternate_emails)
  }
  return out
}

/** Build + send the Daily Briefing email for one brand. */
export async function sendDailyBriefing(args: {
  brand: Brand
  recipients: string[]
  template?: TemplateOverrides | null
}): Promise<SendResult> {
  const { brand, recipients, template } = args
  const sb = serviceClient()
  const meta = BRAND_META[brand]

  if (recipients.length === 0) return { brand, skipped: 'no recipients' }

  const cfg = await loadEmailConfig()
  if (!cfg) return { brand, skipped: 'no email config' }

  const today = new Date().toISOString().slice(0, 10)
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
  const weekAhead = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)

  const { data: events } = await sb.from('events')
    .select('*, days:event_days(*)')
    .eq('brand', brand)
    .gte('start_date', weekAgo)
    .lte('start_date', weekAhead)
    .order('start_date')

  if (!events || events.length === 0) return { brand, skipped: 'no active events' }

  const storeIds = Array.from(new Set(events.map((e: any) => e.store_id)))
  const { data: stores } = await sb.from('stores').select('*').in('id', storeIds)
  const storeMap = Object.fromEntries((stores || []).map((s: any) => [s.id, s]))

  const eventRows = events.map((ev: any) => {
    const store = storeMap[ev.store_id]
    const days = ev.days || []
    const totalPurchases = days.reduce((s: number, d: any) => s + (d.purchases || 0), 0)
    const totalDollars = days.reduce((s: number, d: any) => s + (d.dollars10 || 0) + (d.dollars5 || 0), 0)
    const isActive = ev.start_date <= today && today <= new Date(new Date(ev.start_date + 'T12:00:00').getTime() + 2 * 86400000).toISOString().slice(0, 10)
    return `
      <tr style="border-bottom:1px solid #f0ece4">
        <td style="padding:10px 8px;font-weight:700">${store?.name || ev.store_name}</td>
        <td style="padding:10px 8px;color:#737368">${store?.city ?? ''}, ${store?.state ?? ''}</td>
        <td style="padding:10px 8px;color:#737368">${ev.start_date}</td>
        <td style="padding:10px 8px;text-align:center">${days.length}/3</td>
        <td style="padding:10px 8px;text-align:right;font-weight:700">${totalPurchases}</td>
        <td style="padding:10px 8px;text-align:right;font-weight:700;color:#1D6B44">$${totalDollars.toLocaleString()}</td>
        <td style="padding:10px 8px;text-align:center">${isActive ? '<span style="background:#f0fdf4;color:#14532d;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700">ACTIVE</span>' : ''}</td>
      </tr>`
  }).join('')

  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const vars = { brandLabel: meta.label, emoji: meta.emoji, date: dateStr }

  const subject = substitute(template?.subject || `${meta.emoji} ${meta.label} — Morning Report — ${dateStr}`, vars)
  const greeting = substitute(template?.greeting || `${meta.emoji} ${meta.label} — Morning Report`, vars)
  const subtitle = substitute(template?.header_subtitle || dateStr, vars)
  const footer = substitute(template?.footer || meta.footer, vars)

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:680px;margin:0 auto;padding:24px">
      <div style="font-size:24px;font-weight:900;color:#1a1a16;margin-bottom:4px">${greeting}</div>
      <div style="color:#737368;margin-bottom:24px">${subtitle}</div>
      <div style="background:#fff;border:1px solid #d8d3ca;border-radius:12px;padding:20px">
        <div style="font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#737368;margin-bottom:16px">
          Active & Upcoming Events
        </div>
        <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px">
          <thead>
            <tr style="border-bottom:2px solid #d8d3ca">
              <th style="text-align:left;padding:8px;color:#737368;font-weight:700">Store</th>
              <th style="text-align:left;padding:8px;color:#737368;font-weight:700">Location</th>
              <th style="text-align:left;padding:8px;color:#737368;font-weight:700">Start</th>
              <th style="text-align:center;padding:8px;color:#737368;font-weight:700">Days</th>
              <th style="text-align:right;padding:8px;color:#737368;font-weight:700">Purchases</th>
              <th style="text-align:right;padding:8px;color:#737368;font-weight:700">Revenue</th>
              <th style="text-align:center;padding:8px;color:#737368;font-weight:700">Status</th>
            </tr>
          </thead>
          <tbody>${eventRows}</tbody>
        </table>
      </div>
      <div style="color:#a8a89a;font-size:12px;margin-top:20px;text-align:center">${footer}</div>
    </div>`

  const fromHeader = `${meta.fromName} <${meta.fromEmail}>`

  if (cfg.provider === 'resend') {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromHeader, to: recipients, subject, html }),
    })
  } else if (cfg.provider === 'sendgrid') {
    await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: { email: meta.fromEmail, name: meta.fromName },
        personalizations: [{ to: recipients.map(e => ({ email: e })) }],
        subject,
        content: [{ type: 'text/html', value: html }],
      }),
    })
  }

  return { brand, sent: recipients.length, events: events.length }
}

async function loadEmailConfig(): Promise<{ provider: string; apiKey: string } | null> {
  const sb = serviceClient()
  const { data } = await sb.from('settings').select('value').eq('key', 'email').maybeSingle()
  const cfg = (data as any)?.value as { provider?: string; apiKey?: string } | undefined
  if (!cfg?.apiKey || !cfg.provider) return null
  return { provider: cfg.provider, apiKey: cfg.apiKey }
}

let _client: ReturnType<typeof createClient> | null = null
function serviceClient() {
  if (_client) return _client
  _client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  )
  return _client
}
