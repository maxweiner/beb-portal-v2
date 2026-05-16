// POST /api/buying-communications/send
//
// Mirror of /api/communications/send (trunk side) but scoped to a
// BUYING event instead of a trunk show. Sends an email via Resend
// from the caller's @bebllp.com address, optionally CCs other
// users in the system (resolved by id), and logs the send to
// buying_communication_sends.
//
// Auth: admin / superadmin / partner. Buying-comms management has
// always been admin-level (vs. the rep-can-send model on the trunk
// side).
//
// Body:
//   {
//     event_id: string,
//     template_id: string,
//     subject: string,                // already merged + edited
//     body: string,                   // already merged + edited
//     to_email: string,               // comma-separated allowed
//     to_name?: string | null,
//     cc_user_ids?: string[],         // user ids whose email gets CC'd
//     bcc_emails?: string[],          // ad-hoc BCCs (e.g. audit inbox)
//   }

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { blockIfImpersonating } from '@/lib/impersonation/server'
import { sendEmail } from '@/lib/email'
import { formatRecipients } from '@/lib/communications/recipients'

export const dynamic = 'force-dynamic'

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
  const linkified = escaped.replace(/\b(https?:\/\/[^\s<]+)/g, (url) => `<a href="${url}">${url}</a>`)
  return `<div style="font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.5; color: #222;">${linkified.replace(/\n/g, '<br>')}</div>`
}

export async function POST(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  const isAdmin = me.role === 'admin' || me.role === 'superadmin' || !!me.is_partner
  if (!isAdmin) return NextResponse.json({ error: 'Admin/partner only' }, { status: 403 })

  if (!me.email || !/@bebllp\.com$/i.test(me.email)) {
    return NextResponse.json({
      error: `Sender's email (${me.email}) is not @bebllp.com — Resend will reject the send. Update the user's email and retry.`,
    }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const event_id    = String(body.event_id    || '')
  const template_id = String(body.template_id || '')
  const subject     = String(body.subject     || '').trim()
  const bodyText    = String(body.body        || '').trim()
  const to_email    = String(body.to_email    || '').trim()
  const to_name     = body.to_name ? String(body.to_name) : null
  const cc_user_ids: string[] = Array.isArray(body.cc_user_ids)
    ? body.cc_user_ids.filter((x: any) => typeof x === 'string')
    : []
  const adhoc_bcc: string[] = Array.isArray(body.bcc_emails)
    ? body.bcc_emails.filter((x: any) => typeof x === 'string' && x.includes('@'))
    : []

  if (!event_id || !template_id) {
    return NextResponse.json({ error: 'event_id and template_id required' }, { status: 400 })
  }
  if (!subject || !bodyText) {
    return NextResponse.json({ error: 'Subject and body are required' }, { status: 400 })
  }

  const { toForResend, emails } = formatRecipients(to_email, to_name)
  if (emails.length === 0) {
    return NextResponse.json({ error: 'At least one recipient email required' }, { status: 400 })
  }
  for (const e of emails) {
    if (!e.includes('@')) return NextResponse.json({ error: `Invalid email: ${e}` }, { status: 400 })
  }

  const sb = admin()

  // Kill switch — mirror of the trunk-side safety. Until an admin
  // flips Settings → Buying Comms → Sending enabled, sends 503.
  const { data: enabledSetting } = await sb
    .from('settings').select('value').eq('key', 'buying_comms_send_enabled').maybeSingle()
  const enabledRaw = ((enabledSetting as any)?.value as string | undefined)?.replace(/^"|"$/g, '')
  if (enabledRaw !== 'true') {
    return NextResponse.json({
      error: 'Buying-comms sends are disabled. An admin must flip Settings → Buying Comms → Sending enabled before letters can go out.',
      sending_disabled: true,
    }, { status: 503 })
  }

  // Resolve CC emails from user ids. We pull the user rows here so
  // the log row records the actual addresses, not just the ids.
  let cc_emails: string[] = []
  if (cc_user_ids.length > 0) {
    const { data: ccUsers } = await sb.from('users')
      .select('id, email').in('id', cc_user_ids)
    cc_emails = ((ccUsers || []) as any[])
      .map(u => (u.email || '').trim())
      .filter((e: string) => e && e.includes('@'))
  }

  const fromHeader = `${me.name || me.email} <${me.email}>`
  const html = bodyToHtml(bodyText)

  let messageId: string | null = null
  try {
    messageId = await sendEmail({
      from: fromHeader,
      to: toForResend,
      subject,
      html,
      // CC + BCC: Resend's SendEmailArgs only accepts `to` + a
      // single `replyTo`. We bundle CCs into `to` so they're
      // visible to the recipient. BCCs aren't currently routable
      // through our sendEmail helper — saved on the log row for
      // audit only. Phase 3 adds a richer helper if needed.
      ...(cc_emails.length > 0 ? {} : {}),
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Resend send failed' }, { status: 502 })
  }
  if (!messageId) {
    return NextResponse.json({
      error: 'Resend API key is not configured (settings.email.apiKey is empty).',
    }, { status: 503 })
  }

  // CC delivery: until lib/email supports CC natively, send a
  // separate copy to each CC recipient. They get the same email
  // body verbatim. Failures here don't block the log entry.
  for (const ccAddr of cc_emails) {
    try {
      await sendEmail({
        from: fromHeader,
        to: ccAddr,
        subject: `[cc] ${subject}`,
        html: `<div style="background:#FEF3C7; border-left:3px solid #F59E0B; padding:8px 12px; margin-bottom:14px; font-size:12px; color:#78350F;">You were CC'd on a buying-communication email sent to <strong>${escapeHtml(to_email)}</strong>.</div>` + html,
      })
    } catch (e) {
      console.warn('[buying-comms-send] CC delivery failed for', ccAddr, e)
    }
  }

  // Log the send.
  const sendId = crypto.randomUUID()
  const { data: row, error: insErr } = await sb
    .from('buying_communication_sends')
    .insert({
      id:                    sendId,
      event_id,
      template_id,
      sent_by_user_id:       me.id,
      from_email:            me.email,
      from_name:             me.name || me.email,
      to_email,
      to_name,
      cc_emails,
      bcc_emails:            adhoc_bcc,
      subject_line_rendered: subject,
      body_rendered:         bodyText,
      resend_message_id:     messageId,
      delivery_status:       'sent',
    })
    .select('id')
    .maybeSingle()

  if (insErr || !row) {
    return NextResponse.json({
      error: `Email sent (Resend id ${messageId}) but log write failed: ${insErr?.message || 'unknown'}`,
      message_id: messageId,
    }, { status: 500 })
  }

  return NextResponse.json({ ok: true, send_id: row.id, message_id: messageId })
}
