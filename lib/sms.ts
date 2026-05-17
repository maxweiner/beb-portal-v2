import { createClient } from '@supabase/supabase-js'
import { dispatchSms, type SmsPurpose } from '@/lib/sms/dispatch'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

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
 * Send a single SMS. Provider selection is read from the
 * `sms_providers` settings row at send time so flipping the switch
 * in Settings → SMS Providers takes effect immediately with no
 * redeploy. Silent no-op if neither provider is configured, to keep
 * parity with the email utility's behaviour.
 *
 * `purpose` defaults to 'internal'. Marketing-tagged callers can
 * pass 'marketing' to route through the marketing slot.
 */
export async function sendSMS(
  to: string,
  body: string,
  purpose: SmsPurpose = 'internal',
): Promise<void> {
  const result = await dispatchSms({ sb, to, body, purpose })
  if (!result.ok) {
    // Preserve the historic "silent no-op when unconfigured"
    // behaviour so unrelated cron jobs don't start throwing.
    if (result.error?.includes('not configured')) return
    throw new Error(`SMS ${result.provider} failed: ${result.error}`)
  }
}
