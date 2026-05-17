// Single end-to-end execution of an AI report. Used both by the cron
// worker (which fires on schedule) and by the "Send Now" / "Preview"
// endpoints (which fire manually). Returns the narrative body Claude
// produced + the rendered HTML email + the recipient emails it
// would (or did) send to.

import { createClient } from '@supabase/supabase-js'
import { fetchReportData, formatSnapshotForPrompt } from './dataFetch'
import type { AiReportRow } from './types'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001'
const MAX_TOKENS = 2000

export interface RunReportResult {
  body: string
  html: string
  recipients: Array<{ id: string; email: string; name: string }>
  promptUsed: string
}

export async function runReport(report: AiReportRow): Promise<RunReportResult> {
  const snapshot = await fetchReportData(report.brand, report.time_window)
  const dataBlock = formatSnapshotForPrompt(snapshot)

  const systemPrompt = [
    `You write clear, factual business reports for a jewelry buying / wholesale operation.`,
    `Audience is internal staff and partners. Tone: warm but professional, like a thoughtful colleague writing a memo.`,
    `RULES:`,
    `- Use only the data provided. Do not invent numbers or events.`,
    `- Call out specific stores, buyers, and dollar figures when they're notable.`,
    `- Lead with the headline result, then 2–4 sections of detail, then a short forward look if data suggests one.`,
    `- Use plain HTML for structure: <h2> for section headings, <p> for body, <ul><li> for lists, <strong> for emphasis. NO markdown, NO inline CSS.`,
    `- Total length: 250–500 words. Skip filler. If the data is sparse (e.g. zero events), say so plainly in 2-3 sentences.`,
    `- Reply with ONLY the email body HTML. No preamble, no closing remarks about the task itself.`,
  ].join('\n')

  const userPrompt = [
    `The user has asked you to write the following report:`,
    ``,
    `"${report.prompt}"`,
    ``,
    `Here is the latest data for ${report.brand.toUpperCase()} covering ${snapshot.windowStartIso} through ${snapshot.windowEndIso}:`,
    ``,
    dataBlock,
    ``,
    `Now write the report body as described.`,
  ].join('\n')

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`anthropic_${res.status}: ${text.slice(0, 300)}`)
  }
  const json = await res.json()
  const body = (json?.content?.[0]?.text || '').trim()
  if (!body) throw new Error('Claude returned empty body')

  // Resolve recipient emails
  let recipients: Array<{ id: string; email: string; name: string }> = []
  if (report.recipient_user_ids.length > 0) {
    const { data: users } = await sb
      .from('users')
      .select('id, email, name')
      .in('id', report.recipient_user_ids)
    recipients = (users || [])
      .filter((u: { email?: string | null }) => !!u.email)
      .map((u: { id: string; email: string; name: string }) => ({ id: u.id, email: u.email, name: u.name }))
  }

  const html = renderEmailHtml({
    title: report.name,
    brand: report.brand,
    body,
    windowStart: snapshot.windowStartIso,
    windowEnd: snapshot.windowEndIso,
  })

  return { body, html, recipients, promptUsed: userPrompt }
}

interface RenderArgs {
  title: string
  brand: AiReportRow['brand']
  body: string
  windowStart: string
  windowEnd: string
}

function renderEmailHtml(args: RenderArgs): string {
  const accent = args.brand === 'liberty' ? '#93C5FD' : '#7EC8A0'
  const accentDark = args.brand === 'liberty' ? '#1D3A6B' : '#14532D'
  const brandLabel = args.brand === 'liberty' ? 'Liberty Estate Buyers' : 'Beneficial Estate Buyers'
  return `<!doctype html><html><body style="margin:0;padding:0;background:#F5F0E8;font-family:-apple-system,'Lato',Helvetica,Arial,sans-serif;color:#1A1A16;">
<div style="max-width:640px;margin:0 auto;padding:24px;">
  <div style="background:#fff;border:1px solid #D8D3CA;border-radius:12px;overflow:hidden;">
    <div style="background:${accentDark};padding:18px 24px;color:#fff;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${accent};">${brandLabel}</div>
      <div style="font-size:22px;font-weight:900;margin-top:4px;">${escapeHtml(args.title)}</div>
      <div style="font-size:12px;color:rgba(255,255,255,.7);margin-top:6px;">Data window: ${args.windowStart} → ${args.windowEnd}</div>
    </div>
    <div style="padding:24px;line-height:1.55;font-size:15px;">
      ${args.body}
    </div>
    <div style="padding:14px 24px;border-top:1px solid #EDE8DF;font-size:11px;color:#737368;">
      Generated automatically by Claude · ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET
    </div>
  </div>
</div></body></html>`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c
  ))
}
