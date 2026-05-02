// POST /api/reports/[id]/email
//
// Re-runs a custom report under the caller's auth (so RLS naturally
// gates which underlying tables they can read), generates a CSV, and
// emails it via Resend to a list of recipients. v1 attaches CSV only;
// Excel + PDF land in later PRs.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'
import { runReport } from '@/lib/reports/runQuery'
import { buildCsv } from '@/lib/reports/output'
import type { ReportConfig } from '@/lib/reports/schema'

export const dynamic = 'force-dynamic'

const MAX_RECIPIENTS = 25
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface PostBody {
  recipients?: string[]
  subject?: string
  message?: string
  brand?: 'beb' | 'liberty'
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  // 1. Auth.
  const auth = req.headers.get('authorization') || ''
  const m = auth.match(/^Bearer\s+(.+)$/i)
  if (!m) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const token = m[1]

  const body = (await req.json().catch(() => ({}))) as PostBody
  const recipients = Array.isArray(body.recipients) ? body.recipients : []
  const cleaned = Array.from(new Set(
    recipients.map(s => String(s || '').trim()).filter(s => EMAIL_RE.test(s))
  ))
  if (cleaned.length === 0) {
    return NextResponse.json({ error: 'No valid recipients' }, { status: 400 })
  }
  if (cleaned.length > MAX_RECIPIENTS) {
    return NextResponse.json({ error: `Too many recipients (max ${MAX_RECIPIENTS})` }, { status: 400 })
  }
  const subject = (body.subject || '').trim() || 'Report'
  const message = (body.message || '').trim()
  const brand = body.brand === 'liberty' ? 'liberty' : 'beb'

  // 2. User-scoped client — RLS gates report visibility + table SELECT.
  //    If the caller can't read the report, the SELECT returns null below.
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  )

  const { data: report, error: rErr } = await sb
    .from('custom_reports').select('id, name, source, config').eq('id', params.id).maybeSingle()
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 })
  if (!report) return NextResponse.json({ error: 'Report not found or access denied' }, { status: 404 })

  // 3. Run the report. runReport accepts our user-scoped client.
  const config = (report.config || {}) as ReportConfig
  const result = await runReport(report.source, config, brand, sb)
  if (result.error) {
    return NextResponse.json({ error: `Run failed: ${result.error}` }, { status: 500 })
  }

  // 4. Build CSV + attachment payload.
  const csv = buildCsv(report.source, config, result.rows)
  const slug = String(report.name || 'report').replace(/[^a-z0-9-_]+/gi, '_').slice(0, 60) || 'report'
  const filename = `${slug}_${new Date().toISOString().slice(0, 10)}.csv`
  const csvB64 = Buffer.from(csv, 'utf-8').toString('base64')

  // 5. Build HTML body. Plain — no styling, just the user's message + a
  //    summary line. Recipients see one email per send (no BCC games).
  const html = renderHtml(report.name, message, result.rows.length, result.truncated)

  // 6. Send. Per-recipient calls so a single bad address doesn't tank
  //    the whole batch — collect errors and return them.
  const errors: string[] = []
  let sent = 0
  for (const to of cleaned) {
    try {
      await sendEmail({
        to,
        subject,
        html,
        attachments: [{ filename, content: csvB64 }],
      })
      sent++
    } catch (e: any) {
      errors.push(`${to}: ${e?.message || 'send failed'}`)
    }
  }

  return NextResponse.json({ ok: true, sent, errors })
}

function renderHtml(reportName: string, message: string, rowCount: number, truncated: boolean): string {
  const safeMsg = (message || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
  const safeName = reportName.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
  const truncNote = truncated
    ? '<p style="font-size:12px;color:#92400E;">Note: results were truncated at 10,000 rows. Add filters to the report to get a complete extract.</p>'
    : ''
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111827; line-height: 1.5; font-size: 14px;">
      ${safeMsg ? `<p style="white-space: pre-wrap; margin: 0 0 14px 0;">${safeMsg}</p>` : ''}
      <div style="background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px; padding: 12px 14px; font-size: 13px;">
        <div><strong>Report:</strong> ${safeName}</div>
        <div><strong>Rows:</strong> ${rowCount.toLocaleString()}</div>
        <div><strong>Format:</strong> CSV (attached)</div>
      </div>
      ${truncNote}
    </div>
  `.trim()
}
