// Vercel cron worker — fires due scheduled buying-comm sends.
//
// Selects up to N rows from buying_communication_sends where
// delivery_status='scheduled' AND scheduled_for <= now(), calls
// Resend through the same lib/email path the immediate-send route
// uses, and flips status to 'sent' or 'failed'.
//
// Kill switch: when settings.buying_comms_send_enabled <> 'true'
// every due row is marked 'failed' with failure_reason set. That
// prevents the queue from growing forever while sends are paused
// and gives the operator a clear log when they re-enable.
//
// Schedule: every 15 minutes per vercel.json. The Schedule-send
// UI rounds to a per-minute granularity but cron firing is 15
// min so a 9 AM scheduled send actually fires between 9:00–9:14.
// Acceptable per spec.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'
import { formatRecipients } from '@/lib/communications/recipients'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const BATCH_SIZE = 25

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function bodyToHtml(text: string): string {
  const escaped = escapeHtml(text)
  const linkified = escaped.replace(/\b(https?:\/\/[^\s<]+)/g, url => `<a href="${url}">${url}</a>`)
  return `<div style="font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.5; color: #222;">${linkified.replace(/\n/g, '<br>')}</div>`
}

async function run(req: Request) {
  const url = new URL(req.url)
  const secret = url.searchParams.get('secret')
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = admin()

  // Kill-switch check — done once per tick, applies to every due
  // row this tick.
  const { data: enabledSetting } = await sb
    .from('settings').select('value').eq('key', 'buying_comms_send_enabled').maybeSingle()
  const enabledRaw = ((enabledSetting as any)?.value as string | undefined)?.replace(/^"|"$/g, '')
  const sendingEnabled = enabledRaw === 'true'

  const { data: due } = await sb
    .from('buying_communication_sends')
    .select('id, event_id, template_id, from_email, from_name, to_email, to_name, cc_emails, subject_line_rendered, body_rendered, scheduled_for, sent_by_user_id')
    .eq('delivery_status', 'scheduled')
    .lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(BATCH_SIZE)

  const rows = (due || []) as any[]
  if (rows.length === 0) return NextResponse.json({ ok: true, claimed: 0 })

  let sent = 0, failed = 0

  for (const r of rows) {
    if (!sendingEnabled) {
      await sb.from('buying_communication_sends').update({
        delivery_status: 'failed',
        failure_reason: 'sending_disabled',
        delivery_status_updated_at: new Date().toISOString(),
        sent_at: new Date().toISOString(),
      }).eq('id', r.id).eq('delivery_status', 'scheduled')
      failed++
      continue
    }

    const fromHeader = `${r.from_name} <${r.from_email}>`
    const { toForResend } = formatRecipients(r.to_email, r.to_name)
    const html = bodyToHtml(r.body_rendered)

    let messageId: string | null = null
    try {
      messageId = await sendEmail({
        from: fromHeader,
        to: toForResend,
        subject: r.subject_line_rendered,
        html,
      })
    } catch (e: any) {
      await sb.from('buying_communication_sends').update({
        delivery_status: 'failed',
        failure_reason: (e?.message || 'send_failed').slice(0, 500),
        delivery_status_updated_at: new Date().toISOString(),
        sent_at: new Date().toISOString(),
      }).eq('id', r.id).eq('delivery_status', 'scheduled')
      failed++
      continue
    }

    if (!messageId) {
      await sb.from('buying_communication_sends').update({
        delivery_status: 'failed',
        failure_reason: 'no_message_id',
        delivery_status_updated_at: new Date().toISOString(),
        sent_at: new Date().toISOString(),
      }).eq('id', r.id).eq('delivery_status', 'scheduled')
      failed++
      continue
    }

    // CC fan-out (same pattern as the immediate-send route).
    const ccList: string[] = Array.isArray(r.cc_emails) ? r.cc_emails : []
    for (const ccAddr of ccList) {
      try {
        await sendEmail({
          from: fromHeader,
          to: ccAddr,
          subject: `[cc] ${r.subject_line_rendered}`,
          html: `<div style="background:#FEF3C7; border-left:3px solid #F59E0B; padding:8px 12px; margin-bottom:14px; font-size:12px; color:#78350F;">You were CC'd on a buying-communication email sent to <strong>${escapeHtml(r.to_email)}</strong>.</div>` + html,
        })
      } catch (e) {
        console.warn('[buying-comms-fire-due] CC delivery failed for', ccAddr, e)
      }
    }

    // Mark sent. Use the eq('delivery_status', 'scheduled') guard
    // so a concurrent tick that already grabbed this row doesn't
    // double-fire (effectively a CAS).
    const { error: updErr } = await sb.from('buying_communication_sends').update({
      delivery_status: 'sent',
      delivery_status_updated_at: new Date().toISOString(),
      sent_at: new Date().toISOString(),
      resend_message_id: messageId,
    }).eq('id', r.id).eq('delivery_status', 'scheduled')
    if (updErr) {
      console.warn('[buying-comms-fire-due] status update failed', r.id, updErr.message)
      failed++
      continue
    }

    // Auto-check linked checklist items (mirror of immediate-send).
    if (r.event_id && r.template_id) {
      await sb.from('buying_event_checklist_items').update({
        is_completed: true,
        completed_at: new Date().toISOString(),
        completed_by_user_id: r.sent_by_user_id || null,
        linked_send_id: r.id,
      })
      .eq('event_id', r.event_id)
      .eq('linked_template_id', r.template_id)
      .eq('is_completed', false)
    }

    sent++
  }

  return NextResponse.json({ ok: true, claimed: rows.length, sent, failed })
}

export async function GET(req: Request)  { return run(req) }
export async function POST(req: Request) { return run(req) }
