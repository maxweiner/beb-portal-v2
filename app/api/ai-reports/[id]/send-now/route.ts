// Send Now endpoint — fires an AI report on demand (bypassing
// schedule), emails recipients, and stamps last_sent_at. Used by
// the editor's "Send Now" button after the user previews and is
// happy with the output. Distinct from /preview which doesn't email.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { runReport } from '@/lib/ai-reports/runReport'
import type { AiReportRow } from '@/lib/ai-reports/types'
import { sendEmail } from '@/lib/email'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Verify the caller via their JWT against RLS before bypassing it
  // with the service role to perform the actual send + update.
  const userClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: auth } } },
  )
  const { data: row, error } = await userClient
    .from('ai_reports')
    .select('*')
    .eq('id', params.id)
    .maybeSingle()
  if (error || !row) {
    return NextResponse.json({ error: 'not_found', detail: error?.message }, { status: 404 })
  }

  const report = row as AiReportRow
  const now = new Date()
  try {
    const { body, html, recipients } = await runReport(report)
    if (recipients.length === 0) {
      return NextResponse.json({ error: 'no_recipients' }, { status: 400 })
    }
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
    return NextResponse.json({ ok: true, recipientCount: recipients.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await sb.from('ai_reports').update({
      last_sent_at: now.toISOString(),
      last_send_status: 'error',
      last_send_error: msg.slice(0, 500),
    }).eq('id', report.id)
    return NextResponse.json({ error: 'run_failed', detail: msg.slice(0, 500) }, { status: 500 })
  }
}
