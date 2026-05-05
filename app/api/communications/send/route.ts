// POST /api/communications/send
//
// Auth: admin / superadmin / partner OR sales_rep assigned to
// the trunk show. Sends a templated letter via Resend from the
// caller's @bebllp.com address, logs to communication_sends,
// and auto-checks any open checklist item that's linked to this
// (trunk_show_id, template_id) pair.
//
// PDF generation lives in phase 6 — phase 5 sends an HTML-only
// email and leaves communication_sends.pdf_url null. Delivery
// webhooks (delivered/bounced) are phase 8.
//
// Body:
//   {
//     trunk_show_id, template_id,
//     subject, body,                  // already merged + edited
//     to_email,                       // resolved client-side
//     to_name?,
//     schedule_id?,                   // optional — null = ad-hoc
//   }

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { blockIfImpersonating } from '@/lib/impersonation/server'
import { sendEmail } from '@/lib/email'
import { renderAndUploadLetter } from '@/lib/communications/generatePdf'

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

function pdfFilename(subject: string): string {
  const slug = (subject || 'letter').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'letter'
  return `${slug}.pdf`
}

function bodyToHtml(text: string): string {
  // Plain-text body → HTML. Preserves blank lines as <br><br>,
  // wraps URLs as anchor tags. Phase 6 will replace this with a
  // proper PDF; the email can either keep this HTML body OR get
  // rendered from the PDF. For now, HTML body it is.
  const escaped = escapeHtml(text)
  const linkified = escaped.replace(
    /\b(https?:\/\/[^\s<]+)/g,
    (url) => `<a href="${url}">${url}</a>`,
  )
  return `<div style="font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.5; color: #222;">${linkified.replace(/\n/g, '<br>')}</div>`
}

export async function POST(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  if (!me.email || !/@bebllp\.com$/i.test(me.email)) {
    return NextResponse.json({
      error: `Sender's email (${me.email}) is not @bebllp.com — Resend will reject the send. Update the user's email and retry.`,
    }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const trunk_show_id = String(body.trunk_show_id || '')
  const template_id   = String(body.template_id   || '')
  const subject       = String(body.subject       || '').trim()
  const bodyText      = String(body.body          || '').trim()
  const to_email      = String(body.to_email      || '').trim()
  const to_name       = body.to_name ? String(body.to_name) : null
  const schedule_id   = body.schedule_id ? String(body.schedule_id) : null

  if (!trunk_show_id || !template_id) {
    return NextResponse.json({ error: 'trunk_show_id and template_id required' }, { status: 400 })
  }
  if (!subject || !bodyText) {
    return NextResponse.json({ error: 'Subject and body are required' }, { status: 400 })
  }
  if (!to_email || !to_email.includes('@')) {
    return NextResponse.json({ error: 'Valid recipient email required' }, { status: 400 })
  }

  const sb = admin()

  // SAFETY: trunk-comms sending is disabled by default. Real
  // recipient emails are on file in trunk_show_stores; until an
  // admin explicitly flips the kill switch in Settings, refuse
  // to send. Returns 503 with a clear message the UI surfaces.
  const { data: enabledSetting } = await sb
    .from('settings').select('value').eq('key', 'trunk_comms_send_enabled').maybeSingle()
  const enabledRaw = ((enabledSetting as any)?.value as string | undefined)?.replace(/^"|"$/g, '')
  if (enabledRaw !== 'true') {
    return NextResponse.json({
      error: 'Trunk-show sends are disabled. An admin must flip Settings → Trunk Comms → Sending enabled before letters can go out.',
      sending_disabled: true,
    }, { status: 503 })
  }

  // Authorize: admin/partner OR rep assigned to this show.
  const isAdmin = me.role === 'admin' || me.role === 'superadmin' || !!me.is_partner
  if (!isAdmin) {
    const { data: ts } = await sb
      .from('trunk_shows').select('assigned_rep_id').eq('id', trunk_show_id).maybeSingle()
    if (!ts || ts.assigned_rep_id !== me.id) {
      return NextResponse.json({ error: 'Not assigned to this trunk show' }, { status: 403 })
    }
  }

  const fromHeader = `${me.name || me.email} <${me.email}>`
  const html = bodyToHtml(bodyText)

  // Pre-allocate the send id so the PDF can be filed at
  // communications/{sendId}.pdf before we insert the row.
  const sendId = crypto.randomUUID()

  // Render the PDF (in memory; not uploaded yet). Failure here
  // shouldn't block the send — we fall back to no-attachment.
  let pdfBuffer: Buffer | null = null
  try {
    const { renderLetterBuffer } = await import('@/lib/communications/generatePdf')
    pdfBuffer = await renderLetterBuffer({
      subject,
      body: bodyText,
      storeContact: { name: to_name, email: to_email },
      rep: {
        name:  me.name || me.email,
        email: me.email,
        phone: (me as any).phone || '',
      },
    })
  } catch (e: any) {
    console.error('[comms-send] PDF render failed; sending without attachment:', e?.message)
  }

  let messageId: string | null = null
  try {
    messageId = await sendEmail({
      from: fromHeader,
      to: to_name ? `${to_name} <${to_email}>` : to_email,
      subject,
      html,
      attachments: pdfBuffer ? [{
        filename: pdfFilename(subject),
        content: pdfBuffer.toString('base64'),
      }] : undefined,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Resend send failed' }, { status: 502 })
  }
  if (!messageId) {
    return NextResponse.json({
      error: 'Resend API key is not configured (settings.resend_api_key is empty).',
    }, { status: 503 })
  }

  // Email succeeded. Upload the PDF (best-effort) so the log
  // can link to it. Upload failure doesn't roll back the send.
  let pdfStoragePath: string | null = null
  if (pdfBuffer) {
    try {
      const { error } = await sb.storage.from('communication-pdfs').upload(
        `communications/${sendId}.pdf`,
        pdfBuffer,
        { contentType: 'application/pdf', upsert: true },
      )
      if (!error) pdfStoragePath = `communications/${sendId}.pdf`
    } catch { /* swallow */ }
  }

  // Log the send.
  const { data: row, error: insErr } = await sb
    .from('communication_sends')
    .insert({
      id:                    sendId,
      trunk_show_id,
      template_id,
      schedule_id,
      sent_by_user_id: me.id,
      from_email: me.email,
      from_name:  me.name || me.email,
      to_email,
      to_name,
      subject_line_rendered: subject,
      body_rendered:         bodyText,
      pdf_url:               pdfStoragePath,
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

  // Auto-check linked checklist items for this (show, template).
  // Per spec rule 6c. Multiple items can match (e.g., schedule
  // generated + master generated) — check them all.
  await sb
    .from('trunk_show_checklist_items')
    .update({
      is_completed: true,
      completed_at: new Date().toISOString(),
      completed_by_user_id: me.id,
      linked_send_id: row.id,
    })
    .eq('trunk_show_id', trunk_show_id)
    .eq('linked_template_id', template_id)
    .eq('is_completed', false)

  return NextResponse.json({ ok: true, send_id: row.id, message_id: messageId })
}
