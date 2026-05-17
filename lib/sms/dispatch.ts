// SMS provider dispatcher. Single funnel for all outbound SMS.
//
// The active provider per purpose is stored in settings.value where
// key='sms_providers':
//   { internal: 'twilio' | 'telnyx', marketing: 'twilio' | 'telnyx' }
//
// Callers pass `purpose` to opt into the marketing slot; default is
// 'internal' so the legacy callsites stay routed via the same
// provider they used before the dispatcher existed.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { sendTwilioSms, type SmsSendResult } from './twilio'
import { sendTelnyxSms } from './telnyx'

export type SmsProvider = 'twilio' | 'telnyx'
export type SmsPurpose = 'internal' | 'marketing'

export interface SmsProviderConfig {
  internal: SmsProvider
  marketing: SmsProvider
}

const DEFAULT_PROVIDER_CONFIG: SmsProviderConfig = {
  internal: 'twilio',
  marketing: 'twilio',
}

function adminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function loadSmsProviderConfig(
  sb: SupabaseClient,
): Promise<SmsProviderConfig> {
  const { data } = await sb
    .from('settings').select('value').eq('key', 'sms_providers').maybeSingle()
  const v: any = data?.value || {}
  return {
    internal: v.internal === 'telnyx' ? 'telnyx' : 'twilio',
    marketing: v.marketing === 'telnyx' ? 'telnyx' : 'twilio',
  }
}

export interface DispatchSmsOpts {
  to: string
  body: string
  purpose?: SmsPurpose
  /** Optional pre-built client; the dispatcher creates a service-role
      client if omitted. */
  sb?: SupabaseClient
}

export interface DispatchSmsResult extends SmsSendResult {
  provider: SmsProvider
}

export async function dispatchSms(opts: DispatchSmsOpts): Promise<DispatchSmsResult> {
  const sb = opts.sb || adminClient()
  const purpose: SmsPurpose = opts.purpose || 'internal'
  const config = await loadSmsProviderConfig(sb).catch(() => DEFAULT_PROVIDER_CONFIG)
  const provider = config[purpose]

  if (provider === 'telnyx') {
    const r = await sendTelnyxSms({ sb, to: opts.to, body: opts.body })
    return { ...r, provider }
  }
  const r = await sendTwilioSms({ sb, to: opts.to, body: opts.body })
  return { ...r, provider }
}
