// Cron-triggered queue processor.
// Sends every notification_queue row whose scheduled_for has passed and
// whose status is still 'pending'. Idempotent — a row marked 'sent' won't
// fire twice.
//
// Auth: ?secret=<CRON_SECRET> matching the same pattern as the daily-report
// and reminders crons.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendSMS, formatPhone } from '@/lib/sms'
import { sendEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

function bookingBaseUrl(): string {
  return process.env.NEXT_PUBLIC_BOOKING_BASE_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || 'https://beb-portal-v2.vercel.app'
}
function manageUrl(token: string): string {
  return `${bookingBaseUrl()}/book/manage/${token}`
}

function fmtDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}
function fmtTime(t: string): string {
  const tt = t.length >= 5 ? t.slice(0, 5) : t
  const [h, m] = tt.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

async function run(req: Request) {
  const url = new URL(req.url)
  const secret = url.searchParams.get('secret')
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = admin()
  const now = new Date().toISOString()

  const { data: due } = await sb
    .from('notification_queue')
    .select(`
      id, appointment_id, template_key, channel, recipient,
      appointment:appointments(
        id, cancel_token, customer_name, appointment_date, appointment_time,
        store_id, store:stores(name)
      )
    `)
    .eq('status', 'pending')
    .lte('scheduled_for', now)

  if (!due || due.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, sent: 0 })
  }

  let sent = 0
  let failed = 0

  for (const row of due as any[]) {
    const appt = row.appointment
    if (!appt) {
      await sb.from('notification_queue').update({
        status: 'cancelled',
        error_message: 'Appointment not found',
        updated_at: new Date().toISOString(),
      }).eq('id', row.id)
      continue
    }
    const storeName = appt.store?.name ?? '(your store)'
    const link = manageUrl(appt.cancel_token)
    const date = fmtDate(appt.appointment_date)
    const time = fmtTime(appt.appointment_time)

    try {
      if (row.channel === 'sms') {
        const body =
          `Hi ${appt.customer_name}, your contact info on your ${storeName} appointment ` +
          `(${date} at ${time}) has been updated. Manage: ${link}`
        await sendSMS(row.recipient, body)
      } else if (row.channel === 'email') {
        const html = `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1f2937;">
            <h1 style="font-size:22px;margin:0 0 16px;">Contact info updated</h1>
            <p>Hi ${appt.customer_name},</p>
            <p>The contact information on your appointment at <strong>${storeName}</strong> has been updated.</p>
            <div style="background:#f5f0e8;border-radius:8px;padding:16px;margin:16px 0;">
              <strong style="font-size:16px;">${date}</strong><br/>
              <span style="font-size:16px;">${time}</span>
            </div>
            <p style="text-align:center;margin:24px 0;">
              <a href="${link}" style="display:inline-block;padding:12px 28px;background:#1D6B44;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">
                Manage your appointment
              </a>
            </p>
          </div>`
        await sendEmail({
          to: row.recipient,
          subject: `Your appointment at ${storeName}: contact info updated`,
          html,
        })
      }

      await sb.from('notification_queue').update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', row.id)
      // Mirror into notification_log for the audit trail
      await sb.from('notification_log').insert({
        appointment_id: appt.id,
        type: row.template_key,
        channel: row.channel,
        recipient: row.channel === 'sms' ? (formatPhone(row.recipient) || row.recipient) : row.recipient,
        status: 'sent',
      })
      sent++
    } catch (err: any) {
      console.error('[notification-queue] send failed', err)
      await sb.from('notification_queue').update({
        status: 'failed',
        error_message: err?.message || 'unknown',
        updated_at: new Date().toISOString(),
      }).eq('id', row.id)
      failed++
    }
  }

  return NextResponse.json({ ok: true, scanned: due.length, sent, failed })
}

export async function POST(req: Request) { return run(req) }
export async function GET(req: Request) { return run(req) }
