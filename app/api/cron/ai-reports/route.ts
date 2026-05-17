// Cron worker for AI Reports.
//
// Fires every 15 min. Walks every active row in ai_reports, asks the
// schedule-matcher whether it should fire RIGHT NOW (15-min tolerance
// + last_sent_at guard so we don't double-fire). For each match:
//   1. Fetch the brand+window data snapshot
//   2. Call Claude with the user's prompt + structured data
//   3. Email rendered HTML via Resend to each recipient_user_id
//   4. Stamp last_sent_at + status onto the row
//
// Errors per-row are recorded in last_send_error and don't fail the
// whole cron run — one broken report shouldn't silence the rest.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { runReport } from '@/lib/ai-reports/runReport'
import { shouldFireNow } from '@/lib/ai-reports/scheduleMatch'
import type { AiReportRow } from '@/lib/ai-reports/types'
import { sendEmail } from '@/lib/email'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

const CRON_SECRET = 'bebportal2024'

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')
  if (secret !== CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const now = new Date()

  const { data: rows, error } = await sb
    .from('ai_reports')
    .select('*')
    .eq('active', true)

  if (error) {
    return NextResponse.json({ error: 'fetch_failed', detail: error.message }, { status: 500 })
  }

  const reports = (rows as AiReportRow[]) || []
  const due = reports.filter(r => shouldFireNow(r, now))

  const results: Array<{ id: string; status: 'sent' | 'error' | 'no_recipients'; error?: string }> = []

  for (const report of due) {
    try {
      const { body, html, recipients } = await runReport(report)

      if (recipients.length === 0) {
        await sb.from('ai_reports').update({
          last_sent_at: now.toISOString(),
          last_send_status: 'error',
          last_send_error: 'No recipients on this report',
          last_send_body: body,
        }).eq('id', report.id)
        results.push({ id: report.id, status: 'no_recipients' })
        continue
      }

      // Resend supports an array of `to` addresses on one send. We
      // send a single email with all recipients in `to`. If you want
      // per-recipient personalization later, loop instead.
      await sendEmail({
        to: recipients.map(r => r.email),
        subject: `${report.name} — ${report.brand.toUpperCase()}`,
        html,
      })

      await sb.from('ai_reports').update({
        last_sent_at: now.toISOString(),
        last_send_status: 'sent',
        last_send_error: null,
        last_send_body: body,
      }).eq('id', report.id)
      results.push({ id: report.id, status: 'sent' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await sb.from('ai_reports').update({
        last_sent_at: now.toISOString(),
        last_send_status: 'error',
        last_send_error: msg.slice(0, 500),
      }).eq('id', report.id)
      results.push({ id: report.id, status: 'error', error: msg.slice(0, 200) })
    }
  }

  return NextResponse.json({
    checked: reports.length,
    fired: results.length,
    results,
  })
}
