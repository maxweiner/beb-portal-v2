// Server-side outbound dispatcher for chat messages. Wraps the
// existing Resend (email) and Twilio (SMS) plumbing with the
// chat-specific tweaks: Reply-To is set to replies+<token>@<host>
// so Postmark's inbound webhook can route replies, and the SMS body
// gets a "[ref: TOKEN]" suffix.
//
// The replies host is configured via the REPLIES_INBOX_DOMAIN env
// var (e.g. "replies.bebllp.com"). When unset, email outbound is
// skipped and a "skipped" status is recorded so the UI can surface
// the gap.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'

const REPLIES_DOMAIN = process.env.REPLIES_INBOX_DOMAIN || ''

interface DispatchArgs {
  sb: SupabaseClient
  thread: {
    id: string
    reply_token: string
    external_email: string | null
    external_phone: string | null
    subject: string | null
  }
  senderName: string
  body: string
  alsoEmail: boolean
  alsoSms: boolean
  systemNotePrefix?: string
}

export interface DispatchResult {
  channelsOut: string[]
  emailMessageId: string | null
  smsSid: string | null
  deliveryStatus: Record<string, { status: string; error?: string }>
  systemNotes: string[]
}

export async function dispatchChatMessage(args: DispatchArgs): Promise<DispatchResult> {
  const channelsOut: string[] = []
  const deliveryStatus: Record<string, { status: string; error?: string }> = {}
  const systemNotes: string[] = []
  let emailMessageId: string | null = null
  let smsSid: string | null = null

  // Email
  if (args.alsoEmail) {
    if (!args.thread.external_email) {
      systemNotes.push('Email skipped — no email on file')
      deliveryStatus.email = { status: 'skipped', error: 'no_email_on_file' }
    } else if (!REPLIES_DOMAIN) {
      systemNotes.push('Email skipped — REPLIES_INBOX_DOMAIN not configured')
      deliveryStatus.email = { status: 'skipped', error: 'replies_domain_unset' }
    } else {
      const replyAddr = `replies+${args.thread.reply_token}@${REPLIES_DOMAIN}`
      try {
        await sendEmail({
          to: args.thread.external_email,
          subject: args.thread.subject || `Message from ${args.senderName}`,
          html: buildEmailHtml(args.body, args.senderName),
          replyTo: replyAddr,
        })
        emailMessageId = replyAddr // Postmark's webhook keys on the To address; using the reply addr as our local correlation id is fine.
        channelsOut.push('email')
        deliveryStatus.email = { status: 'sent' }
      } catch (err: any) {
        deliveryStatus.email = { status: 'failed', error: (err?.message || 'send failed').toString().slice(0, 200) }
        systemNotes.push(`Email send failed: ${deliveryStatus.email.error}`)
      }
    }
  }

  // SMS
  if (args.alsoSms) {
    if (!args.thread.external_phone) {
      systemNotes.push('SMS skipped — no phone on file')
      deliveryStatus.sms = { status: 'skipped', error: 'no_phone_on_file' }
    } else {
      const result = await sendSms({
        sb: args.sb,
        to: args.thread.external_phone,
        body: `${args.body}\n\n[ref: ${args.thread.reply_token}]`,
      })
      if (result.ok) {
        smsSid = result.sid || null
        channelsOut.push('sms')
        deliveryStatus.sms = { status: 'sent' }
      } else {
        deliveryStatus.sms = { status: 'failed', error: result.error?.slice(0, 200) }
        systemNotes.push(`SMS send failed: ${result.error}`)
      }
    }
  }

  return { channelsOut, emailMessageId, smsSid, deliveryStatus, systemNotes }
}

function buildEmailHtml(body: string, senderName: string): string {
  const safe = body.replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch] as string))
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a16;max-width:560px;margin:0 auto;padding:20px;background:#F5F0E8">
    <div style="background:#1D6B44;color:#fff;font-weight:700;font-size:13px;padding:6px 14px;border-radius:14px;display:inline-block;margin-bottom:14px">
      ◆ Beneficial Estate Buyers
    </div>
    <p style="font-size:14px;color:#4A4A42;margin:0 0 8px"><b>${senderName}</b> wrote:</p>
    <div style="background:#fff;border:1px solid #EDE7DA;border-radius:8px;padding:14px;font-size:14px;line-height:1.55;white-space:pre-wrap">${safe}</div>
    <p style="font-size:11px;color:#A8A89A;margin:14px 0 0">Reply to this email — your response lands in the BEB portal automatically.</p>
  </div>`
}

interface SmsOpts { sb: SupabaseClient; to: string; body: string }
async function sendSms(opts: SmsOpts): Promise<{ ok: boolean; sid?: string; error?: string }> {
  // Routes through the provider dispatcher so the Settings → SMS
  // Providers switch decides which carrier handles chat replies.
  // Chat is treated as 'internal' (staff↔customer one-to-one).
  const { dispatchSms } = await import('@/lib/sms/dispatch')
  return dispatchSms({ sb: opts.sb, to: opts.to, body: opts.body, purpose: 'internal' })
}
