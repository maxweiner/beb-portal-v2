// Confirmation, cancellation, and reminder messaging for the appointment system.
// Best-effort: notification failures never block the booking flow itself.
// All sends are logged to public.notification_log for audit/debugging.

import { createClient } from '@supabase/supabase-js'
import { sendSMS, formatPhone } from '@/lib/sms'
import { sendEmail } from '@/lib/email'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } },
)

type NotificationType =
  | 'sms_confirmation' | 'email_confirmation'
  | 'sms_reminder_24h' | 'sms_reminder_2h'
  | 'email_reminder_24h' | 'email_reminder_2h'
  | 'sms_cancellation' | 'email_cancellation'

export interface AppointmentForNotify {
  id: string
  cancel_token: string
  customer_name: string
  customer_phone: string
  customer_email: string
  appointment_date: string
  appointment_time: string
}

export interface StoreForNotify {
  name: string
  slug: string | null
  owner_phone?: string | null
  owner_email?: string | null
}

function bookingBaseUrl(): string {
  return process.env.NEXT_PUBLIC_BOOKING_BASE_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || 'https://beb-portal-v2.vercel.app'
}

function manageUrl(token: string): string {
  return `${bookingBaseUrl()}/book/manage/${token}`
}

function formatTimePretty(hhmm: string): string {
  const t = hhmm.length >= 5 ? hhmm.slice(0, 5) : hhmm
  const [h, m] = t.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

function formatDatePretty(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

async function logNotification(args: {
  appointment_id: string
  type: NotificationType
  channel: 'sms' | 'email'
  recipient: string
  status: 'sent' | 'failed'
  provider_id?: string | null
  error_message?: string | null
}) {
  await sb.from('notification_log').insert({
    appointment_id: args.appointment_id,
    type: args.type,
    channel: args.channel,
    recipient: args.recipient,
    status: args.status,
    provider_id: args.provider_id ?? null,
    error_message: args.error_message ?? null,
  })
}

interface SendArgs {
  appt: AppointmentForNotify
  store: StoreForNotify
}

// ---------- confirmation ----------

export async function sendConfirmation({ appt, store }: SendArgs) {
  const date = formatDatePretty(appt.appointment_date)
  const time = formatTimePretty(appt.appointment_time)
  const link = manageUrl(appt.cancel_token)

  // SMS
  if (appt.customer_phone) {
    const body =
      `Hi ${appt.customer_name}, you're booked at ${store.name} on ${date} at ${time}. ` +
      `Need to change or cancel? ${link}`
    try {
      await sendSMS(appt.customer_phone, body)
      await logNotification({
        appointment_id: appt.id, type: 'sms_confirmation', channel: 'sms',
        recipient: formatPhone(appt.customer_phone) || appt.customer_phone, status: 'sent',
      })
    } catch (err: any) {
      console.error('confirmation SMS failed', err)
      await logNotification({
        appointment_id: appt.id, type: 'sms_confirmation', channel: 'sms',
        recipient: appt.customer_phone, status: 'failed', error_message: err?.message,
      })
    }
  }

  // Email
  if (appt.customer_email) {
    const html = confirmationEmailHtml({ appt, store, date, time, link })
    try {
      const id = await sendEmail({
        to: appt.customer_email,
        subject: `Your appointment at ${store.name} is confirmed`,
        html,
      })
      await logNotification({
        appointment_id: appt.id, type: 'email_confirmation', channel: 'email',
        recipient: appt.customer_email, status: 'sent', provider_id: id,
      })
    } catch (err: any) {
      console.error('confirmation email failed', err)
      await logNotification({
        appointment_id: appt.id, type: 'email_confirmation', channel: 'email',
        recipient: appt.customer_email, status: 'failed', error_message: err?.message,
      })
    }
  }
}

// ---------- cancellation ----------

export async function sendCancellation({ appt, store, skipSms = false }: SendArgs & { skipSms?: boolean }) {
  const date = formatDatePretty(appt.appointment_date)
  const time = formatTimePretty(appt.appointment_time)
  const rebookLink = store.slug ? `${bookingBaseUrl()}/book/${store.slug}` : null

  if (!skipSms && appt.customer_phone) {
    const body =
      `Your appointment at ${store.name} on ${date} at ${time} has been cancelled.` +
      (rebookLink ? ` To rebook: ${rebookLink}` : '')
    try {
      await sendSMS(appt.customer_phone, body)
      await logNotification({
        appointment_id: appt.id, type: 'sms_cancellation', channel: 'sms',
        recipient: formatPhone(appt.customer_phone) || appt.customer_phone, status: 'sent',
      })
    } catch (err: any) {
      console.error('cancellation SMS failed', err)
      await logNotification({
        appointment_id: appt.id, type: 'sms_cancellation', channel: 'sms',
        recipient: appt.customer_phone, status: 'failed', error_message: err?.message,
      })
    }
  }

  if (appt.customer_email) {
    const html = cancellationEmailHtml({ appt, store, date, time, rebookLink })
    try {
      const id = await sendEmail({
        to: appt.customer_email,
        subject: `Your appointment at ${store.name} has been cancelled`,
        html,
      })
      await logNotification({
        appointment_id: appt.id, type: 'email_cancellation', channel: 'email',
        recipient: appt.customer_email, status: 'sent', provider_id: id,
      })
    } catch (err: any) {
      console.error('cancellation email failed', err)
      await logNotification({
        appointment_id: appt.id, type: 'email_cancellation', channel: 'email',
        recipient: appt.customer_email, status: 'failed', error_message: err?.message,
      })
    }
  }
}

// ---------- reminder ----------

export async function sendReminder({ appt, store, hours }: SendArgs & { hours: 24 | 2 }) {
  const date = formatDatePretty(appt.appointment_date)
  const time = formatTimePretty(appt.appointment_time)
  const link = manageUrl(appt.cancel_token)
  const phrase = hours === 24 ? 'tomorrow' : 'in 2 hours'

  const smsType = hours === 24 ? 'sms_reminder_24h' : 'sms_reminder_2h'
  const emailType = hours === 24 ? 'email_reminder_24h' : 'email_reminder_2h'

  if (appt.customer_phone) {
    const body =
      `Reminder: your appointment at ${store.name} is ${phrase} (${date} at ${time}). ` +
      `Manage or cancel: ${link}`
    try {
      await sendSMS(appt.customer_phone, body)
      await logNotification({
        appointment_id: appt.id, type: smsType, channel: 'sms',
        recipient: formatPhone(appt.customer_phone) || appt.customer_phone, status: 'sent',
      })
    } catch (err: any) {
      console.error(`${hours}h reminder SMS failed`, err)
      await logNotification({
        appointment_id: appt.id, type: smsType, channel: 'sms',
        recipient: appt.customer_phone, status: 'failed', error_message: err?.message,
      })
    }
  }

  if (appt.customer_email) {
    const html = reminderEmailHtml({ appt, store, date, time, link, phrase })
    try {
      const id = await sendEmail({
        to: appt.customer_email,
        subject: `Reminder: your appointment at ${store.name} is ${phrase}`,
        html,
      })
      await logNotification({
        appointment_id: appt.id, type: emailType, channel: 'email',
        recipient: appt.customer_email, status: 'sent', provider_id: id,
      })
    } catch (err: any) {
      console.error(`${hours}h reminder email failed`, err)
      await logNotification({
        appointment_id: appt.id, type: emailType, channel: 'email',
        recipient: appt.customer_email, status: 'failed', error_message: err?.message,
      })
    }
  }
}

// ---------- email templates ----------

function shell(inner: string): string {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1f2937;">
      ${inner}
      <p style="font-size:12px;color:#6b7280;margin-top:32px;border-top:1px solid #e5e7eb;padding-top:16px;">
        Beneficial Estate Buyers
      </p>
    </div>
  `
}

function confirmationEmailHtml({ appt, store, date, time, link }: SendArgs & { date: string; time: string; link: string }) {
  return shell(`
    <h1 style="font-size:22px;margin:0 0 16px;">You're booked!</h1>
    <p>Hi ${appt.customer_name},</p>
    <p>Your appointment at <strong>${store.name}</strong> is confirmed for:</p>
    <div style="background:#f5f0e8;border-radius:8px;padding:16px;margin:16px 0;">
      <strong style="font-size:16px;">${date}</strong><br/>
      <span style="font-size:16px;">${time}</span>
    </div>
    <p>Need to reschedule or cancel? Use the link below — no login required.</p>
    <p style="text-align:center;margin:24px 0;">
      <a href="${link}" style="display:inline-block;padding:12px 28px;background:#1D6B44;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">
        Manage your appointment
      </a>
    </p>
    <p style="font-size:13px;color:#6b7280;">Or paste this link into your browser: ${link}</p>
  `)
}

function cancellationEmailHtml({ appt, store, date, time, rebookLink }: SendArgs & { date: string; time: string; rebookLink: string | null }) {
  return shell(`
    <h1 style="font-size:22px;margin:0 0 16px;">Appointment cancelled</h1>
    <p>Hi ${appt.customer_name},</p>
    <p>Your appointment at <strong>${store.name}</strong> on <strong>${date} at ${time}</strong> has been cancelled.</p>
    ${rebookLink
      ? `<p style="text-align:center;margin:24px 0;">
           <a href="${rebookLink}" style="display:inline-block;padding:12px 28px;background:#1D6B44;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">
             Book another time
           </a>
         </p>`
      : ''}
  `)
}

function reminderEmailHtml({ appt, store, date, time, link, phrase }: SendArgs & { date: string; time: string; link: string; phrase: string }) {
  return shell(`
    <h1 style="font-size:22px;margin:0 0 16px;">See you ${phrase}</h1>
    <p>Hi ${appt.customer_name},</p>
    <p>This is a reminder that your appointment at <strong>${store.name}</strong> is ${phrase}:</p>
    <div style="background:#f5f0e8;border-radius:8px;padding:16px;margin:16px 0;">
      <strong style="font-size:16px;">${date}</strong><br/>
      <span style="font-size:16px;">${time}</span>
    </div>
    <p>Need to reschedule or cancel?</p>
    <p style="text-align:center;margin:24px 0;">
      <a href="${link}" style="display:inline-block;padding:12px 28px;background:#1D6B44;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">
        Manage your appointment
      </a>
    </p>
  `)
}
