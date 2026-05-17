// Telnyx Messaging — inbound webhook verification + outbound send.
//
// Inbound: Telnyx signs each webhook with ed25519 over
//   `${timestamp}|${rawBody}`. Headers: `telnyx-signature-ed25519`
//   (base64 sig) and `telnyx-timestamp`. Public key is in Mission
//   Control → Messaging → API Keys → Public Key.
//
// Credentials live in settings.value where key='telnyx':
//   { apiKey, fromNumber, publicKey, messagingProfileId? }
// — mirroring the existing Resend / Twilio settings pattern.

import crypto from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SmsSendResult } from './twilio'

export interface TelnyxConfig {
  apiKey?: string
  fromNumber?: string
  publicKey?: string
  messagingProfileId?: string
}

export async function loadTelnyxConfig(sb: SupabaseClient): Promise<TelnyxConfig> {
  const { data } = await sb
    .from('settings').select('value').eq('key', 'telnyx').maybeSingle()
  return (data?.value || {}) as TelnyxConfig
}

export type TelnyxInboundEvent = {
  data: {
    event_type: string
    id?: string
    payload: {
      id?: string
      text?: string
      from?: { phone_number?: string; carrier?: string; line_type?: string }
      to?: Array<{ phone_number?: string; status?: string }>
      direction?: 'inbound' | 'outbound'
      received_at?: string
      messaging_profile_id?: string
    }
  }
  meta?: unknown
}

// Telnyx publishes the public key as a 32-byte ed25519 key, base64-encoded.
// Node's crypto wants a KeyObject; the cheapest portable way is to wrap the
// raw key in the standard SPKI ASN.1 prefix and import it as DER.
const ED25519_SPKI_PREFIX = Buffer.from([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
])

function publicKeyFromBase64(b64: string): crypto.KeyObject {
  const raw = Buffer.from(b64, 'base64')
  if (raw.length !== 32) {
    throw new Error(`TELNYX_PUBLIC_KEY decoded to ${raw.length} bytes; expected 32`)
  }
  const spki = Buffer.concat([ED25519_SPKI_PREFIX, raw])
  return crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' })
}

export function verifyTelnyxSignature(opts: {
  rawBody: string
  timestamp: string | null
  signature: string | null
  publicKeyB64: string
  toleranceSeconds?: number
}): { ok: true } | { ok: false; reason: string } {
  const { rawBody, timestamp, signature, publicKeyB64 } = opts
  const tolerance = opts.toleranceSeconds ?? 300

  if (!timestamp || !signature) return { ok: false, reason: 'missing_signature_headers' }
  const tsNum = Number(timestamp)
  if (!Number.isFinite(tsNum)) return { ok: false, reason: 'bad_timestamp' }
  const ageSec = Math.abs(Date.now() / 1000 - tsNum)
  if (ageSec > tolerance) return { ok: false, reason: 'stale_timestamp' }

  let key: crypto.KeyObject
  try {
    key = publicKeyFromBase64(publicKeyB64)
  } catch (e: any) {
    return { ok: false, reason: `bad_public_key:${e?.message || 'unknown'}` }
  }

  const sigBuf = Buffer.from(signature, 'base64')
  const msg = Buffer.from(`${timestamp}|${rawBody}`)
  const ok = crypto.verify(null, msg, key, sigBuf)
  return ok ? { ok: true } : { ok: false, reason: 'signature_mismatch' }
}

/** Normalize "+15551234567" / "15551234567" / "(555) 123-4567" to "5551234567". */
export function normalizeTelnyxPhone(p: string | null | undefined): string {
  const digits = String(p || '').replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  return digits
}

/** Convert any reasonable input to E.164. Returns '' if unusable. */
function toE164(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return `+${digits.replace(/^\+/, '')}`
}

export async function sendTelnyxSms(opts: {
  sb: SupabaseClient
  to: string
  body: string
  cfg?: TelnyxConfig
}): Promise<SmsSendResult> {
  const cfg = opts.cfg || (await loadTelnyxConfig(opts.sb))
  if (!cfg.apiKey || !cfg.fromNumber) {
    return { ok: false, error: 'Telnyx not configured in Admin → SMS Settings' }
  }
  const e164 = toE164(opts.to)
  if (!e164) return { ok: false, error: 'invalid phone' }

  const payload: Record<string, unknown> = {
    from: cfg.fromNumber,
    to: e164,
    text: opts.body,
  }
  if (cfg.messagingProfileId) payload.messaging_profile_id = cfg.messagingProfileId

  try {
    const res = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    const j: any = await res.json().catch(() => ({}))
    if (!res.ok) {
      const msg = j?.errors?.[0]?.detail || j?.errors?.[0]?.title || res.statusText
      return { ok: false, error: msg }
    }
    return { ok: true, sid: j?.data?.id }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'telnyx send error' }
  }
}
