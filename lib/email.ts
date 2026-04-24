import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

/**
 * Resend API key lives in the settings table at key='resend_api_key'.
 * From-address default mirrors the existing marketing-email/daily-report routes.
 */
const DEFAULT_FROM = 'Beneficial Estate Buyers <noreply@bebllp.com>'

async function loadKey(): Promise<string | null> {
  const { data } = await sb.from('settings').select('value').eq('key', 'resend_api_key').maybeSingle()
  return data?.value || null
}

export interface SendEmailArgs {
  to: string
  subject: string
  html: string
  from?: string
}

/**
 * Send a transactional email via Resend. Silent no-op if no API key is
 * configured. Returns the Resend message id on success or throws on error.
 */
export async function sendEmail({ to, subject, html, from }: SendEmailArgs): Promise<string | null> {
  const key = await loadKey()
  if (!key) return null

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: from || DEFAULT_FROM, to, subject, html }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Resend ${res.status}: ${text}`)
  }
  const json = await res.json().catch(() => ({}))
  return json?.id ?? null
}
