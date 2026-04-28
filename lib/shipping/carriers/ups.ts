// UPS tracking client.
//
// Auth: OAuth 2.0 client_credentials. Token endpoint expects HTTP Basic
// (base64 of client_id:client_secret) — different from FedEx, which puts
// the credentials in the form body. Tokens are 4h-lived; cached in
// process and refreshed ~60s before expiry.
//
// API docs: https://developer.ups.com/api/reference?loc=en_US#operation/getSingleTrackResponseUsingGET
//
// Env vars required:
//   UPS_CLIENT_ID      — Client ID from the developer portal
//   UPS_CLIENT_SECRET  — Client Secret from the developer portal
//   UPS_BASE_URL       — https://onlinetools.ups.com (prod)
//                       | https://wwwcie.ups.com  (CIE / sandbox)

import { CarrierError, type CarrierStatusResult, type NormalizedStatus } from './types'

interface CachedToken { token: string; expiresAt: number }
let cachedToken: CachedToken | null = null

function baseUrl(): string {
  const u = process.env.UPS_BASE_URL
  if (!u) throw new CarrierError('UPS_BASE_URL is not set')
  return u.replace(/\/+$/, '')
}

async function getAccessToken(): Promise<string> {
  const now = Date.now()
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.token
  }
  const id = process.env.UPS_CLIENT_ID
  const secret = process.env.UPS_CLIENT_SECRET
  if (!id || !secret) throw new CarrierError('UPS_CLIENT_ID / UPS_CLIENT_SECRET not set')
  const basic = Buffer.from(`${id}:${secret}`).toString('base64')
  const res = await fetch(`${baseUrl()}/security/v1/oauth/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: 'grant_type=client_credentials',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new CarrierError(`UPS OAuth failed (${res.status}): ${text.slice(0, 300)}`)
  }
  const json = await res.json() as { access_token?: string; expires_in?: number | string }
  if (!json.access_token) throw new CarrierError('UPS OAuth: no access_token in response')
  const ttlSec = typeof json.expires_in === 'string' ? parseInt(json.expires_in, 10) : (json.expires_in ?? 14400)
  cachedToken = { token: json.access_token, expiresAt: now + ttlSec * 1000 }
  return json.access_token
}

// UPS status.type letter codes — most reliable normalized signal.
// (Fallback: scan currentStatus.description text.)
function statusFromType(t: string | null | undefined): NormalizedStatus | null {
  switch (t) {
    case 'D': return 'delivered'
    case 'O': return 'out_for_delivery'
    case 'I': return 'in_transit'
    case 'P': return 'in_transit'  // Pickup scan
    case 'M': return 'label_created'  // Manifest pickup (label generated)
    case 'MV': return 'label_created'
    case 'X': return 'exception'
    case 'RS': return 'returned'
    default: return null
  }
}

function statusFromDescription(d: string | null | undefined): NormalizedStatus {
  const s = (d ?? '').toLowerCase()
  if (!s) return 'unknown'
  if (s.includes('delivered')) return 'delivered'
  if (s.includes('out for delivery')) return 'out_for_delivery'
  if (s.includes('label') && s.includes('created')) return 'label_created'
  if (s.includes('shipper created')) return 'label_created'
  if (s.includes('exception')) return 'exception'
  if (s.includes('return')) return 'returned'
  if (s.includes('transit') || s.includes('picked up') || s.includes('departed') || s.includes('arrived')) return 'in_transit'
  return 'unknown'
}

// UPS dates are YYYYMMDD; times are HHMMSS. Combine into ISO 8601.
function upsDateTimeIso(date: string | null | undefined, time: string | null | undefined): string | null {
  if (!date || date.length !== 8) return null
  const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
  if (!time) return `${iso}T12:00:00Z`
  const t = time.padStart(6, '0').slice(0, 6)
  return `${iso}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}Z`
}

function upsDateIso(date: string | null | undefined): string | null {
  if (!date || date.length !== 8) return null
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
}

/** Look up tracking status for a single UPS tracking number. */
export async function getUpsStatus(trackingNumber: string): Promise<CarrierStatusResult> {
  const token = await getAccessToken()
  // transId must be unique per request (≤32 chars). transactionSrc is free-form.
  const transId = `beb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const res = await fetch(
    `${baseUrl()}/api/track/v1/details/${encodeURIComponent(trackingNumber)}?locale=en_US&returnSignature=false&returnMilestones=false&returnPOD=false`,
    {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'transId': transId,
        'transactionSrc': 'beb-portal',
        'Accept': 'application/json',
      },
    },
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new CarrierError(`UPS tracking failed (${res.status}): ${text.slice(0, 300)}`)
  }
  const json = await res.json() as any

  const pkg = json?.trackResponse?.shipment?.[0]?.package?.[0]
  if (!pkg) {
    // UPS sometimes returns a top-level errors array.
    const err = json?.response?.errors?.[0]
    if (err) throw new CarrierError(`UPS tracking error: ${err.code} ${err.message ?? ''}`)
    throw new CarrierError('UPS tracking: empty result')
  }

  const current = pkg.currentStatus ?? {}
  const activity = Array.isArray(pkg.activity) ? pkg.activity : []
  const latest = activity[0] ?? {}
  const latestStatus = latest.status ?? {}

  const typeBased = statusFromType(current.type ?? latestStatus.type)
  const status: NormalizedStatus = typeBased
    ?? statusFromDescription(current.description ?? latestStatus.description)
  const statusDetail: string | null = current.description ?? latestStatus.description ?? null
  const lastEvent: string | null = latestStatus.description ?? current.description ?? null

  // deliveryDate types: DEL = delivered, SDD = scheduled delivery, RDD = rescheduled delivery.
  const deliveryDates = Array.isArray(pkg.deliveryDate) ? pkg.deliveryDate : []
  const findDate = (type: string) => deliveryDates.find((d: any) => d?.type === type)?.date as string | undefined
  const eta = upsDateIso(findDate('RDD') ?? findDate('SDD'))
  const deliveredDate = findDate('DEL')
  const deliveredAt = status === 'delivered'
    ? upsDateTimeIso(deliveredDate ?? latest.date, latest.time ?? pkg.deliveryTime?.endTime)
    : null
  const eventAt = upsDateTimeIso(latest.date, latest.time)

  return {
    status,
    statusDetail,
    lastEvent,
    eventAt,
    eta,
    deliveredAt,
    raw: pkg,
  }
}
