// FedEx tracking client.
//
// Auth: OAuth 2.0 client_credentials. Tokens are ~1h-lived; we cache
// per process and refresh ~60s before expiry. Vercel Fluid Compute
// reuses instances so the cache amortizes across requests.
//
// API docs: https://developer.fedex.com/api/en-us/catalog/track.html
//
// Env vars required:
//   FEDEX_API_KEY        — client_id from the developer portal
//   FEDEX_SECRET_KEY     — client_secret from the developer portal
//   FEDEX_BASE_URL       — https://apis.fedex.com (prod) | https://apis-sandbox.fedex.com

import { CarrierError, type CarrierStatusResult, type NormalizedStatus } from './types'

interface CachedToken { token: string; expiresAt: number }
let cachedToken: CachedToken | null = null

function baseUrl(): string {
  const u = process.env.FEDEX_BASE_URL
  if (!u) throw new CarrierError('FEDEX_BASE_URL is not set')
  return u.replace(/\/+$/, '')
}

async function getAccessToken(): Promise<string> {
  const now = Date.now()
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.token
  }
  const apiKey = process.env.FEDEX_API_KEY
  const secret = process.env.FEDEX_SECRET_KEY
  if (!apiKey || !secret) {
    throw new CarrierError('FEDEX_API_KEY / FEDEX_SECRET_KEY not set')
  }
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: apiKey,
    client_secret: secret,
  })
  const res = await fetch(`${baseUrl()}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new CarrierError(`FedEx OAuth failed (${res.status}): ${text.slice(0, 200)}`)
  }
  const json = await res.json() as { access_token?: string; expires_in?: number }
  if (!json.access_token) throw new CarrierError('FedEx OAuth: no access_token in response')
  const ttlMs = (json.expires_in ?? 3600) * 1000
  cachedToken = { token: json.access_token, expiresAt: now + ttlMs }
  return json.access_token
}

// FedEx status code → normalized. Codes from latestStatusDetail.code.
// https://developer.fedex.com/api/en-us/guides/api-reference.html#trackingstatuscodes
const STATUS_MAP: Record<string, NormalizedStatus> = {
  IN: 'label_created',  // Initiated
  AR: 'in_transit',     // Arrived at FedEx location
  AF: 'in_transit',     // At FedEx destination facility
  AC: 'in_transit',     // At carrier
  AP: 'in_transit',     // At Pickup
  CA: 'exception',      // Shipment cancelled
  CH: 'in_transit',     // Location changed
  DE: 'exception',      // Delivery exception
  DL: 'delivered',      // Delivered
  DP: 'in_transit',     // Departed
  DR: 'delivered',      // Vehicle furnished but not used
  DS: 'in_transit',     // Vehicle dispatched
  DY: 'exception',      // Delay
  EA: 'in_transit',     // Enroute to airport
  EO: 'in_transit',     // Enroute to origin airport
  EP: 'in_transit',     // Enroute to pickup
  FD: 'in_transit',     // At FedEx destination
  HL: 'in_transit',     // Hold at location
  IT: 'in_transit',     // In transit
  IX: 'in_transit',     // In transit (international)
  LO: 'in_transit',     // Left origin
  OC: 'label_created',  // Order created
  OD: 'out_for_delivery', // Out for delivery
  OF: 'in_transit',     // At FedEx origin facility
  OX: 'in_transit',     // Shipment information sent to FedEx
  PD: 'in_transit',     // Pickup delay
  PF: 'in_transit',     // Plane in flight
  PL: 'in_transit',     // Plane landed
  PM: 'in_transit',     // In progress
  PU: 'in_transit',     // Picked up
  PX: 'in_transit',     // Picked up (see Details for clearance status)
  RR: 'returned',       // CDO requested
  RC: 'returned',       // CDO cancelled
  RM: 'returned',       // CDO modified
  RS: 'returned',       // Returned to shipper
  SE: 'exception',      // Shipment exception
  SF: 'in_transit',     // At sort facility
  SP: 'in_transit',     // Split status
  TR: 'in_transit',     // Transfer
}

function normalizeStatus(code: string | null | undefined): NormalizedStatus {
  if (!code) return 'unknown'
  return STATUS_MAP[code] ?? 'unknown'
}

/** Look up tracking status for a single FedEx tracking number. */
export async function getFedexStatus(trackingNumber: string): Promise<CarrierStatusResult> {
  const token = await getAccessToken()
  const res = await fetch(`${baseUrl()}/track/v1/trackingnumbers`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-locale': 'en_US',
    },
    body: JSON.stringify({
      includeDetailedScans: false,
      trackingInfo: [
        { trackingNumberInfo: { trackingNumber } },
      ],
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new CarrierError(`FedEx tracking failed (${res.status}): ${text.slice(0, 300)}`)
  }
  const json = await res.json() as any

  // Response shape:
  // output.completeTrackResults[0].trackResults[0]
  //   .latestStatusDetail.{code,statusByLocale,description}
  //   .dateAndTimes[] {type, dateTime}     // type: ACTUAL_DELIVERY, ESTIMATED_DELIVERY, SHIP, ...
  //   .estimatedDeliveryTimeWindow.window.ends
  //   .scanEvents[0] {eventDescription, date}    (only if includeDetailedScans=true; latestStatusDetail covers most cases)
  //   .error  (per-tracking error)
  const result = json?.output?.completeTrackResults?.[0]?.trackResults?.[0]
  if (!result) {
    throw new CarrierError('FedEx tracking: empty result')
  }
  if (result.error?.code) {
    throw new CarrierError(`FedEx tracking error: ${result.error.code} ${result.error.message ?? ''}`)
  }

  const latest = result.latestStatusDetail ?? {}
  const status = normalizeStatus(latest.code)
  const statusDetail: string | null = latest.statusByLocale ?? latest.description ?? latest.code ?? null
  const lastEvent: string | null = latest.description ?? latest.statusByLocale ?? null

  const dt = (Array.isArray(result.dateAndTimes) ? result.dateAndTimes : []) as any[]
  const findDate = (type: string) => dt.find(d => d?.type === type)?.dateTime ?? null
  const deliveredAt = findDate('ACTUAL_DELIVERY')
  const etaIso: string | null =
    findDate('ESTIMATED_DELIVERY')
    ?? result?.estimatedDeliveryTimeWindow?.window?.ends
    ?? null
  const eta = etaIso ? etaIso.slice(0, 10) : null
  const eventAt = deliveredAt ?? findDate('ACTUAL_PICKUP') ?? findDate('SHIP') ?? null

  return {
    status,
    statusDetail,
    lastEvent,
    eventAt,
    eta,
    deliveredAt,
    raw: result,
  }
}
