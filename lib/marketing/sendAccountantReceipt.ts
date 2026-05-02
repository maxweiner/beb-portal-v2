// Generates the marketing accountant receipt PDF, uploads it to the
// marketing-pdfs bucket at {campaign_id}.pdf, and emails the
// accountant with the PDF attached. Stamps
// marketing_campaigns.accountant_receipt_sent_at on success.
//
// Idempotent: regenerates + reuploads on every call so the attachment
// always reflects the current campaign state.

import { createClient } from '@supabase/supabase-js'
import { renderToBuffer } from '@react-pdf/renderer'
import { sendEmail } from '@/lib/email'
import { MarketingReceiptPdf } from './receiptPdf'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

const FLOW_LABELS = {
  vdp:       'VDP Mailers',
  postcard:  'Postcards',
  newspaper: 'Newspaper',
} as const

async function loadAccountantEmails(): Promise<string[]> {
  // Reuses the same settings keys that the expenses module uses, per
  // spec ("same accountant address used for expense reports"). Optional
  // accountant_email_2 sends a copy to a second address. Strips
  // wrapping quotes to tolerate JSON.stringify'd values.
  const sb = admin()
  const [{ data: a }, { data: b }] = await Promise.all([
    sb.from('settings').select('value').eq('key', 'accountant_email').maybeSingle(),
    sb.from('settings').select('value').eq('key', 'accountant_email_2').maybeSingle(),
  ])
  const clean = (v: any) => (v as string | undefined)?.trim().replace(/^"|"$/g, '') || ''
  const out = [clean((a as any)?.value), clean((b as any)?.value)].filter(Boolean)
  if (out.length === 0 && process.env.ACCOUNTANT_EMAIL) out.push(process.env.ACCOUNTANT_EMAIL)
  return Array.from(new Set(out.map(s => s.toLowerCase())))
}

export interface SendReceiptResult {
  ok: boolean
  reason?: 'no_accountant_address' | 'send_failed' | 'campaign_not_done'
  pdfPath?: string
  error?: string
}

export async function sendMarketingReceiptForCampaign(campaignId: string): Promise<SendReceiptResult> {
  const sb = admin()

  // Pull campaign + event + store + approver/paid-by names. Bail if
  // the campaign isn't actually done.
  const { data: campaign } = await sb.from('marketing_campaigns')
    .select('id, event_id, flow_type, status, marketing_budget, payment_method_label, payment_method_note, payment_authorized_by, paid_at, paid_by')
    .eq('id', campaignId).maybeSingle()
  if (!campaign) throw new Error('Campaign not found')
  if (campaign.status !== 'done' || !campaign.paid_at) {
    return { ok: false, reason: 'campaign_not_done' }
  }

  const accountantTos = await loadAccountantEmails()
  if (accountantTos.length === 0) return { ok: false, reason: 'no_accountant_address' }

  const { data: event } = await sb.from('events')
    .select('store_id, store_name, start_date').eq('id', campaign.event_id).maybeSingle()
  const { data: store } = event?.store_id
    ? await sb.from('stores').select('name, address, city, state, zip').eq('id', event.store_id).maybeSingle()
    : { data: null as any }
  const storeName = store?.name || event?.store_name || '(unknown store)'
  const storeAddress = [store?.address, store?.city, store?.state, store?.zip]
    .filter(Boolean).join(', ')

  const userIds = [campaign.payment_authorized_by, campaign.paid_by].filter(Boolean) as string[]
  const { data: people } = userIds.length > 0
    ? await sb.from('users').select('id, name').in('id', userIds)
    : { data: [] as any[] }
  const nameById = new Map(((people ?? []) as { id: string; name: string }[]).map(u => [u.id, u.name]))
  const approverName = (campaign.payment_authorized_by && nameById.get(campaign.payment_authorized_by)) || '(approver)'
  const paidByName = (campaign.paid_by && nameById.get(campaign.paid_by)) || '(Collected)'

  // Try to use the same logo the expense module uses, if available.
  // Mirrors the bytes-loading pattern from lib/expenses/generatePdf.ts.
  let logo: Buffer | null = null
  try {
    const fs = await import('fs/promises')
    const path = await import('path')
    const candidates = ['public/logo-wordmark.png', 'public/icon-512.png']
    for (const rel of candidates) {
      try {
        const buf = await fs.readFile(path.join(process.cwd(), rel))
        logo = buf
        break
      } catch { /* try next */ }
    }
  } catch { /* renderer falls back to text wordmark */ }

  const pdfBuffer = await renderToBuffer(
    MarketingReceiptPdf({
      campaignId: campaign.id,
      flowType: campaign.flow_type as any,
      storeName,
      storeAddress,
      eventStart: event?.start_date || '',
      budget: Number(campaign.marketing_budget || 0),
      paymentMethodLabel: campaign.payment_method_label || '(no method)',
      paymentMethodNote: campaign.payment_method_note,
      approverName,
      paidAt: campaign.paid_at,
      paidByName,
      logo,
    }) as any
  )

  const pdfPath = `${campaign.id}.pdf`
  const { error: upErr } = await sb.storage.from('marketing-pdfs')
    .upload(pdfPath, pdfBuffer, { contentType: 'application/pdf', upsert: true })
  if (upErr) throw new Error('PDF upload failed: ' + upErr.message)

  // Render template (reuse report_templates row marketing-accountant-receipt)
  const { data: tpl } = await sb.from('report_templates')
    .select('subject, greeting, header_subtitle, footer, shoutout_fallback')
    .eq('id', 'marketing-accountant-receipt').maybeSingle()

  const dateRange = event?.start_date ? fmtDateRange(event.start_date) : ''
  const amountStr = Number(campaign.marketing_budget || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const paidAtStr = new Date(campaign.paid_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  const vars = {
    store_name: storeName,
    date_range: dateRange,
    amount_paid: amountStr,
    payment_method_label: campaign.payment_method_label || '',
    paid_at: paidAtStr,
  } as Record<string, string>

  const subject = sub(tpl?.subject || `Marketing receipt: ${storeName} (${dateRange}) · $${amountStr}`, vars)
  const greeting = sub(tpl?.greeting || 'Receipt attached.', vars)
  const subtitle = sub(tpl?.header_subtitle || `${storeName} · ${dateRange}`, vars)
  const body = sub(tpl?.shoutout_fallback || `Marketing for ${storeName} (${dateRange}) has been paid: $${amountStr} on ${campaign.payment_method_label} on ${paidAtStr}. PDF attached.`, vars)
  const footer = sub(tpl?.footer || 'Beneficial Estate Buyers', vars)

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;background:#f5f0e8;padding:20px;">
      <div style="background:#2D3B2D;padding:20px 24px;border-radius:8px 8px 0 0;color:#fff;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#7EC8A0;margin-bottom:4px;">Beneficial Estate Buyers</div>
        <div style="font-size:18px;font-weight:900;">${escapeHtml(greeting)}</div>
        <div style="font-size:13px;color:rgba(255,255,255,.6);margin-top:4px;">${escapeHtml(subtitle)}</div>
      </div>
      <div style="background:#fff;padding:24px;border:1px solid #e8e0d0;border-top:none;font-size:14px;color:#333;line-height:1.6;">
        <div>${escapeHtml(body).replace(/\n/g, '<br/>')}</div>
      </div>
      <div style="background:#fff;padding:14px 28px;border:1px solid #e8e0d0;border-top:none;border-radius:0 0 8px 8px;text-align:center;font-size:12px;color:#a8a89a;">
        ${escapeHtml(footer)}
      </div>
    </div>
  `

  // Per-recipient sends so a single bad address doesn't tank the batch.
  let sentCount = 0
  let firstError: string | null = null
  for (const to of accountantTos) {
    try {
      await sendEmail({
        to,
        subject,
        html,
        attachments: [{
          filename: `marketing-receipt-${storeName.replace(/[^A-Za-z0-9-]+/g, '_')}-${campaign.id.slice(0, 8)}.pdf`,
          content: pdfBuffer.toString('base64'),
        }],
      })
      sentCount++
    } catch (err: any) {
      if (firstError === null) firstError = err?.message || 'unknown'
    }
  }
  if (sentCount === 0) {
    return { ok: false, reason: 'send_failed', pdfPath, error: firstError ?? 'no addresses succeeded' }
  }

  await sb.from('marketing_campaigns')
    .update({ accountant_receipt_sent_at: new Date().toISOString() })
    .eq('id', campaign.id)

  return { ok: true, pdfPath }
}

function sub(text: string, vars: Record<string, string>): string {
  return (text || '').replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '')
}
function escapeHtml(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function fmtDateRange(startIso: string): string {
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
