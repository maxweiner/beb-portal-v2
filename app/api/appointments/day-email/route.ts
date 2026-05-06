// POST /api/appointments/day-email
//
// Body: {
//   store_id: string,
//   date: string,            // YYYY-MM-DD
//   recipients: string[],    // bare emails (already resolved on client)
//   subject?: string,
//   message?: string,
//   sender_name?: string,
// }
//
// Renders the daily-appointments PDF for the store + date, attaches it
// to a transactional email, and sends one message per recipient.
// Reports per-address sent/failed back to the UI for partial-success.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { generateAppointmentsDayPdfBuffer } from '@/lib/appointments/generateAppointmentsDayPdf'
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
const DATE_RE  = /^\d{4}-\d{2}-\d{2}$/

export async function POST(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const storeId = String(body?.store_id || '')
  if (!storeId) return NextResponse.json({ error: 'Missing store_id' }, { status: 400 })

  // Accept either a single `date` (legacy) or `dates` array (multi-day).
  const datesIn: unknown = body?.dates
  const dateIn:  unknown = body?.date
  const datesRaw: string[] = Array.isArray(datesIn)
    ? datesIn.map((x: any) => String(x || '').trim()).filter(Boolean)
    : (typeof dateIn === 'string' && dateIn ? [dateIn.trim()] : [])
  if (datesRaw.length === 0 || !datesRaw.every(d => DATE_RE.test(d))) {
    return NextResponse.json({ error: 'Invalid or missing dates' }, { status: 400 })
  }
  const dates = Array.from(new Set(datesRaw)).sort()

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
  const result = await generateAppointmentsDayPdfBuffer({ sb, storeId, dates })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  const fmtLong = (ds: string) =>
    new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const fmtShort = (ds: string) =>
    new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const dateRangeLabel = dates.length === 1
    ? fmtLong(dates[0])
    : `${fmtShort(dates[0])} – ${fmtShort(dates[dates.length - 1])}`

  const subject = (typeof body?.subject === 'string' && body.subject.trim())
    ? body.subject.trim()
    : `${result.storeName} — ${dateRangeLabel} appointments (${result.rowCount})`

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
      <h2 style="margin:0 0 6px;font-size:18px;color:#1a1a16">${escapeHtml(result.storeName)}</h2>
      <p style="margin:0 0 14px;color:#4A4A42;font-size:13px">
        Appointment schedule for <b>${escapeHtml(dateRangeLabel)}</b> — ${result.rowCount} ${result.rowCount === 1 ? 'appointment' : 'appointments'}, attached as a PDF.
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
    dates,
    store_id: storeId,
    row_count: result.rowCount,
    sent_count: sent.length,
    failed_count: failed.length,
    sent,
    failed,
  })
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch] as string))
}
