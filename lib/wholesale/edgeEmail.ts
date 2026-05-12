// Resend send helper for Edge wholesale-export batches.
//
// Brand from-address mirrors the convention used in the morning-
// briefing route. API key is loaded from the `settings` table
// (key='email').

import { pdfAdmin } from './pdfHelpers'

const FROM_BY_BRAND: Record<string, { name: string; email: string }> = {
  liberty: { name: 'Liberty Estate Buyers', email: 'noreply@libertyestatebuyers.com' },
  beb:     { name: 'BEB Portal',            email: 'noreply@updates.bebllp.com' },
}

interface SendBatchEmailInput {
  brand: 'liberty' | 'beb'
  to: string
  toName?: string | null
  cc?: string[]
  bcc?: string[]
  batchCode: string
  itemCount: number
  photoCount: number
  batchUrl: string
  notes?: string | null
  csv: string
  /** Filename for the attached CSV (e.g. EDGE-20260512-A4F2.csv). */
  csvFilename: string
}

export interface SendBatchEmailResult {
  ok: boolean
  messageId?: string
  error?: string
}

export async function sendBatchEmail(input: SendBatchEmailInput): Promise<SendBatchEmailResult> {
  // Pull the Resend API key from the same settings row the rest of the
  // app uses. Reuses the shared service-role client helper.
  const sb = pdfAdmin()

  const { data: cfgRow, error: cfgErr } = await sb
    .from('settings').select('value').eq('key', 'email').maybeSingle()
  if (cfgErr) return { ok: false, error: `settings load: ${cfgErr.message}` }
  const apiKey = (cfgRow?.value as any)?.apiKey
  if (!apiKey) return { ok: false, error: 'Resend API key missing from settings.email.apiKey' }

  const from = FROM_BY_BRAND[input.brand] || FROM_BY_BRAND.liberty
  const fromHeader = `${from.name} <${from.email}>`

  const subject = `New inventory from ${from.name} — ${input.batchCode} (${input.itemCount} item${input.itemCount === 1 ? '' : 's'})`
  const html = buildHtml(input)

  // Resend accepts attachments as either url or base64 content. Base64
  // works for everything; cap CSV size sanity-check just in case (real
  // batches are < a few KB).
  const csvBase64 = Buffer.from(input.csv, 'utf8').toString('base64')

  const body: any = {
    from: fromHeader,
    to: [input.to],
    subject,
    html,
    attachments: [
      { filename: input.csvFilename, content: csvBase64 },
    ],
  }
  if (input.cc && input.cc.length) body.cc = input.cc
  if (input.bcc && input.bcc.length) body.bcc = input.bcc

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    return { ok: false, error: `Resend ${r.status}: ${text || r.statusText}` }
  }
  const json = await r.json().catch(() => ({}))
  return { ok: true, messageId: (json as any)?.id }
}

function buildHtml(input: SendBatchEmailInput): string {
  const greeting = input.toName ? `Hi ${escapeHtml(input.toName)},` : 'Hi,'
  const notesBlock = input.notes
    ? `<p style="margin: 16px 0; padding: 12px 14px; background:#FAF8F4; border-left: 3px solid #1D6B44; color:#1f2937; white-space:pre-wrap;">${escapeHtml(input.notes)}</p>`
    : ''
  return `<!DOCTYPE html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color: #1f2937; max-width: 600px; margin: 0 auto; padding: 24px;">
  <p style="margin: 0 0 12px;">${greeting}</p>
  <p style="margin: 0 0 16px;">A new inventory batch is ready for review — <strong>${input.itemCount} item${input.itemCount === 1 ? '' : 's'}</strong>, <strong>${input.photoCount} photo${input.photoCount === 1 ? '' : 's'}</strong>.</p>
  <p style="margin: 0 0 16px;">Batch code: <code style="background:#FAF8F4; padding:2px 6px; border-radius:4px;">${input.batchCode}</code></p>
  ${notesBlock}
  <p style="margin: 24px 0;">
    <a href="${input.batchUrl}"
       style="display:inline-block; background:#1D6B44; color:#fff; padding:12px 22px; border-radius:8px; text-decoration:none; font-weight:700;">
      View batch &amp; download photos
    </a>
  </p>
  <p style="margin: 24px 0 0; font-size: 13px; color:#6b7280;">The CSV is attached. Photos are downloadable individually or all at once from the batch page linked above.</p>
  <p style="margin: 12px 0 0; font-size: 12px; color:#9ca3af;">Reply to this email if anything looks off — we'll iterate quickly.</p>
</body></html>`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
