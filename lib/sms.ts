import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

/**
 * Twilio config lives in the same pattern as email — a JSON value
 * in the settings table under key='sms':
 *   { accountSid: 'ACxxx', authToken: 'xxx', fromNumber: '+1XXXXXXXXXX' }
 */
interface SmsConfig {
  accountSid?: string
  authToken?: string
  fromNumber?: string
}

async function loadConfig(): Promise<SmsConfig> {
  const { data } = await sb.from('settings').select('value').eq('key', 'sms').maybeSingle()
  return (data?.value || {}) as SmsConfig
}

/**
 * Normalize a phone number to E.164 (+1XXXXXXXXXX). Returns '' if
 * there aren't enough digits to be usable.
 */
export function formatPhone(phone: string): string {
  const digits = (phone || '').replace(/\D+/g, '')
  if (digits.length < 10) return ''
  if (digits.length === 10) return '+1' + digits
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits
  return '+' + digits
}

/**
 * Send a single SMS via Twilio. Silent no-op if no config is set
 * (matching the email utility's behaviour). Throws on Twilio errors
 * so callers can log/continue per-recipient without blocking a batch.
 */
export async function sendSMS(to: string, body: string): Promise<void> {
  const cfg = await loadConfig()
  if (!cfg.accountSid || !cfg.authToken || !cfg.fromNumber) return

  const toE164 = formatPhone(to)
  if (!toE164) throw new Error(`Invalid phone number: ${to}`)

  const params = new URLSearchParams({
    From: cfg.fromNumber,
    To: toE164,
    Body: body,
  })

  const authBytes = `${cfg.accountSid}:${cfg.authToken}`
  // Buffer works on Node/Edge; avoid btoa for SSR safety.
  const basic = typeof Buffer !== 'undefined'
    ? Buffer.from(authBytes).toString('base64')
    : btoa(authBytes)

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    },
  )

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Twilio ${res.status}: ${text}`)
  }
}
