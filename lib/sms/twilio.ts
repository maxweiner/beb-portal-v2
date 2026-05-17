// Twilio outbound sender. Reads credentials from settings table.
//
// Historic state: two callsites had inline Twilio impls — one in
// `lib/sms.ts` reading settings.key='sms', one in `lib/chat/sender.ts`
// reading settings.key='twilio'. This module unifies them: it reads
// 'twilio' first, falls back to 'sms', so both legacy rows still work.

import type { SupabaseClient } from '@supabase/supabase-js'

export interface TwilioConfig {
  accountSid?: string
  authToken?: string
  fromNumber?: string
}

export async function loadTwilioConfig(sb: SupabaseClient): Promise<TwilioConfig> {
  const { data: twilioRow } = await sb
    .from('settings').select('value').eq('key', 'twilio').maybeSingle()
  if (twilioRow?.value) return twilioRow.value as TwilioConfig
  const { data: smsRow } = await sb
    .from('settings').select('value').eq('key', 'sms').maybeSingle()
  return (smsRow?.value || {}) as TwilioConfig
}

export function toE164(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return `+${digits.replace(/^\+/, '')}`
}

export interface SmsSendResult {
  ok: boolean
  sid?: string
  error?: string
}

export async function sendTwilioSms(opts: {
  sb: SupabaseClient
  to: string
  body: string
  cfg?: TwilioConfig
}): Promise<SmsSendResult> {
  const cfg = opts.cfg || (await loadTwilioConfig(opts.sb))
  if (!cfg.accountSid || !cfg.authToken || !cfg.fromNumber) {
    return { ok: false, error: 'Twilio not configured in Admin → SMS Settings' }
  }

  const e164 = toE164(opts.to)
  if (!e164) return { ok: false, error: 'invalid phone' }

  const auth = Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64')
  const params = new URLSearchParams({ To: e164, From: cfg.fromNumber, Body: opts.body })

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      },
    )
    const j: any = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: j.message || res.statusText }
    return { ok: true, sid: j.sid }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'twilio send error' }
  }
}
