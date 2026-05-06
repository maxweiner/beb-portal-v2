// POST /api/events/[id]/day-email/[day]
//
// Body: {
//   recipients: string[]   // bare email addresses (already resolved on the client)
//   subject?:   string     // optional override
//   message?:   string     // optional plain-text intro
//   sender_name?: string   // user-display name on the From line
// }
//
// Renders the buying-day PDF for the event + through-day, attaches it
// to a transactional email, sends one message per recipient. Each
// send is independent — partial success is reported back so the UI
// can show "5 sent, 1 failed".

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { generateDayPdfBuffer } from '@/lib/dayentry/generateDayPdf'
import { sendEmail } from '@/lib/email'
import { blockIfImpersonating } from '@/lib/impersonation/server'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: Request, { params }: { params: { id: string; day: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  const dayParam = params.day
  const throughDay = (dayParam === 'recap' || dayParam === '0') ? null : parseInt(dayParam, 10)
  if (throughDay !== null && (Number.isNaN(throughDay) || throughDay < 1)) {
    return NextResponse.json({ error: 'Invalid day' }, { status: 400 })
  }

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const recipientsRaw: unknown = body?.recipients
  if (!Array.isArray(recipientsRaw) || recipientsRaw.length === 0) {
    return NextResponse.json({ error: 'No recipients' }, { status: 400 })
  }
  const recipients = Array.from(new Set(
    recipientsRaw
      .filter((x: any) => typeof x === 'string')
      .map((x: string) => x.trim().toLowerCase())
      .filter(e => EMAIL_RE.test(e)),
  ))
  if (recipients.length === 0) {
    return NextResponse.json({ error: 'No valid recipients' }, { status: 400 })
  }

  const sb = admin()
  const result = await generateDayPdfBuffer({ sb, eventId: params.id, throughDay })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  const subject = (typeof body?.subject === 'string' && body.subject.trim())
    ? body.subject.trim()
    : `${result.eventName} — ${throughDay ? `Day ${throughDay} numbers` : 'Event recap'}`

  const senderName = typeof body?.sender_name === 'string' ? body.sender_name.trim() : ''
  const messageRaw = typeof body?.message === 'string' ? body.message.trim() : ''
  const messageHtml = messageRaw
    ? `<p style="white-space:pre-wrap;margin:0 0 16px">${escapeHtml(messageRaw)}</p>`
    : ''

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a16;max-width:560px;margin:0 auto;padding:20px;background:#F5F0E8">
      <div style="background:#1D6B44;color:#fff;font-weight:700;font-size:13px;padding:6px 14px;border-radius:14px;display:inline-block;margin-bottom:14px">
        ◆ Beneficial Estate Buyers
      </div>
      <h2 style="margin:0 0 6px;font-size:18px;color:#1a1a16">${escapeHtml(result.eventName)}</h2>
      <p style="margin:0 0 14px;color:#4A4A42;font-size:13px">
        ${throughDay ? `Through Day ${throughDay}` : 'Full event recap'} attached as a PDF.
      </p>
      ${messageHtml}
      <p style="margin:16px 0 0;color:#A8A89A;font-size:12px">
        ${senderName ? `Sent by ${escapeHtml(senderName)} · ` : ''}Beneficial Estate Buyers
      </p>
    </div>
  `

  const attachment = {
    filename: result.filename,
    content: result.buffer.toString('base64'),
  }

  const sent: string[] = []
  const failed: { email: string; error: string }[] = []
  for (const email of recipients) {
    try {
      await sendEmail({ to: email, subject, html, attachments: [attachment] })
      sent.push(email)
    } catch (err: any) {
      failed.push({ email, error: err?.message || 'send failed' })
    }
  }

  return NextResponse.json({
    ok: true,
    through_day: throughDay,
    sent_count: sent.length,
    failed_count: failed.length,
    sent,
    failed,
  })
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch] as string))
}
