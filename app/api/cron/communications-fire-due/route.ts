// GET /api/cron/communications-fire-due
//
// Fires every 15 minutes (vercel.json). Picks up any
// communication_sends rows where:
//   delivery_status = 'scheduled' AND scheduled_for <= now()
// and runs them through the Resend send pipeline. On success the
// row flips to delivery_status='sent' with the actual sent_at /
// resend_message_id / pdf_url filled in. On failure: status='failed'
// with failure_reason populated AND a heads-up email to the rep
// who originally scheduled it.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'
import { formatRecipients } from '@/lib/communications/recipients'

export const dynamic = 'force-dynamic'

const CRON_SECRET = 'bebportal2024'  // matches the vercel.json convention

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
function pdfFilename(subject: string): string {
  const slug = (subject || 'letter').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'letter'
  return `${slug}.pdf`
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  if (url.searchParams.get('secret') !== CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = admin()
  const nowIso = new Date().toISOString()

  // Pull due rows. Cap to a reasonable batch so a backlog doesn't
  // overwhelm the runtime.
  const { data: rows, error: fetchErr } = await sb
    .from('communication_sends')
    .select('id, trunk_show_id, template_id, scheduled_for, scheduled_by_user_id, from_email, from_name, to_email, to_name, subject_line_rendered, body_rendered')
    .eq('delivery_status', 'scheduled')
    .lte('scheduled_for', nowIso)
    .order('scheduled_for', { ascending: true })
    .limit(50)

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  }
  if (!rows || rows.length === 0) {
    return NextResponse.json({ ok: true, fired: 0 })
  }

  let sentCount = 0
  let failedCount = 0

  for (const row of rows) {
    try {
      const subject = row.subject_line_rendered
      const bodyText = row.body_rendered
      const fromHeader = `${row.from_name || row.from_email} <${row.from_email}>`
      // to_email + to_name may be comma-separated when the scheduler
      // picked multiple flagged contacts. Resend rejects a single
      // comma-joined string — split + pair them properly.
      const { toForResend } = formatRecipients(row.to_email, row.to_name)

      // PDF generation (best-effort).
      let pdfBuffer: Buffer | null = null
      try {
        const { renderLetterBuffer } = await import('@/lib/communications/generatePdf')
        pdfBuffer = await renderLetterBuffer({
          subject,
          body: bodyText,
          storeContact: { name: row.to_name, email: row.to_email },
          rep: {
            name:  row.from_name || row.from_email,
            email: row.from_email,
            phone: '',
          },
        })
      } catch (e: any) {
        console.error('[cron-comms] PDF render failed; sending without attachment:', e?.message)
      }

      const messageId = await sendEmail({
        from: fromHeader,
        to: toForResend,
        subject,
        html: bodyToHtml(bodyText),
        attachments: pdfBuffer ? [{
          filename: pdfFilename(subject),
          content: pdfBuffer.toString('base64'),
        }] : undefined,
      })

      if (!messageId) throw new Error('Resend API key is not configured')

      // Upload the PDF (best-effort).
      let pdfStoragePath: string | null = null
      if (pdfBuffer) {
        try {
          const { error } = await sb.storage.from('communication-pdfs').upload(
            `communications/${row.id}.pdf`,
            pdfBuffer,
            { contentType: 'application/pdf', upsert: true },
          )
          if (!error) pdfStoragePath = `communications/${row.id}.pdf`
        } catch { /* swallow */ }
      }

      await sb
        .from('communication_sends')
        .update({
          delivery_status:   'sent',
          sent_at:           new Date().toISOString(),
          // The cron worker is the de-facto sender if no scheduler is set.
          sent_by_user_id:   row.scheduled_by_user_id,
          resend_message_id: messageId,
          pdf_url:           pdfStoragePath,
        })
        .eq('id', row.id)

      // Auto-check linked checklist items.
      if (row.template_id) {
        await sb
          .from('trunk_show_checklist_items')
          .update({
            is_completed: true,
            completed_at: new Date().toISOString(),
            completed_by_user_id: row.scheduled_by_user_id,
            linked_send_id: row.id,
          })
          .eq('trunk_show_id', row.trunk_show_id)
          .eq('linked_template_id', row.template_id)
          .eq('is_completed', false)
      }

      sentCount++
    } catch (err: any) {
      // Failure path — mark row + email the scheduler.
      const reason = (err?.message || 'Unknown error').toString().slice(0, 500)
      await sb
        .from('communication_sends')
        .update({
          delivery_status: 'failed',
          failure_reason:  reason,
        })
        .eq('id', row.id)

      try {
        if (row.scheduled_by_user_id) {
          const { data: scheduler } = await sb
            .from('users').select('email, name').eq('id', row.scheduled_by_user_id).maybeSingle()
          if (scheduler?.email) {
            await sendEmail({
              to: scheduler.email,
              subject: `❌ Scheduled letter failed to send`,
              html: `<p>Your scheduled trunk-show letter <strong>"${escapeHtml(row.subject_line_rendered)}"</strong> failed to send.</p>
                     <p><strong>Reason:</strong> ${escapeHtml(reason)}</p>
                     <p>Recipient: ${escapeHtml(row.to_email)}</p>
                     <p>Open the trunk show in the BEB Portal to reschedule.</p>`,
            })
          }
        }
      } catch (notifyErr: any) {
        console.error('[cron-comms] Failed to notify scheduler:', notifyErr?.message)
      }

      failedCount++
    }
  }

  return NextResponse.json({ ok: true, fired: rows.length, sent: sentCount, failed: failedCount })
}
