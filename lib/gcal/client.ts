// Minimal Google Calendar v3 client backed by a service account.
//
// Reads the service-account JSON from process.env.GOOGLE_SERVICE_ACCOUNT_JSON
// and signs an RS256 JWT to exchange for a short-lived OAuth access token.
// Tokens are cached in module scope until ~5 min before expiry.
//
// We avoid pulling in `googleapis` to keep the bundle small and the runtime
// agnostic — Vercel cron route runs in Node and crypto + fetch are enough.

import crypto from 'crypto'

interface ServiceAccount {
  client_email: string
  private_key: string
  token_uri?: string
}

interface CachedToken {
  token: string
  expiresAt: number
}

let cached: CachedToken | null = null

function loadServiceAccount(): ServiceAccount {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON env var is not set')
  const sa = JSON.parse(raw) as ServiceAccount
  if (!sa.client_email || !sa.private_key) {
    throw new Error('Service account JSON missing client_email or private_key')
  }
  return sa
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64')
    .replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function buildJwt(sa: ServiceAccount, scopes: string[]): string {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss: sa.client_email,
    scope: scopes.join(' '),
    aud: sa.token_uri || 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }
  const message = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`
  const signature = crypto.createSign('RSA-SHA256').update(message).sign(sa.private_key)
  return `${message}.${base64url(signature)}`
}

async function getAccessToken(): Promise<string> {
  if (cached && cached.expiresAt - 5 * 60 * 1000 > Date.now()) return cached.token

  const sa = loadServiceAccount()
  const jwt = buildJwt(sa, ['https://www.googleapis.com/auth/calendar'])

  const res = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Google OAuth: ${json.error_description || json.error || res.status}`)

  cached = {
    token: json.access_token as string,
    expiresAt: Date.now() + (json.expires_in as number) * 1000,
  }
  return cached.token
}

// ── Calendar API helpers ─────────────────────────────────────

export interface GcalEventInput {
  summary: string
  description?: string
  location?: string
  startDate: string  // YYYY-MM-DD
  endDate: string    // YYYY-MM-DD (Google's all-day end is exclusive)
  source?: { title: string; url: string }
}

function buildEventBody(input: GcalEventInput): Record<string, any> {
  return {
    summary: input.summary,
    description: input.description || '',
    location: input.location || '',
    start: { date: input.startDate },
    end: { date: input.endDate },
    ...(input.source ? { source: input.source } : {}),
  }
}

async function api(method: string, path: string, body?: any): Promise<any> {
  const token = await getAccessToken()
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  // 204 No Content (DELETE) — no body to parse.
  if (res.status === 204) return null
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = json?.error?.message || `HTTP ${res.status}`
    const err: any = new Error(`Google Calendar: ${msg}`)
    err.status = res.status
    err.body = json
    throw err
  }
  return json
}

export async function createGcalEvent(calendarId: string, input: GcalEventInput): Promise<{ id: string }> {
  const json = await api('POST', `/calendars/${encodeURIComponent(calendarId)}/events`, buildEventBody(input))
  return { id: json.id as string }
}

export async function patchGcalEvent(calendarId: string, eventId: string, input: GcalEventInput): Promise<void> {
  await api('PATCH', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, buildEventBody(input))
}

export async function deleteGcalEvent(calendarId: string, eventId: string): Promise<void> {
  try {
    await api('DELETE', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`)
  } catch (e: any) {
    // 404 / 410 = already gone — treat as success.
    if (e?.status === 404 || e?.status === 410) return
    throw e
  }
}

/**
 * Smoke test: create + delete a tiny event to verify the calendar is
 * shared with the service account and the calendar id is correct.
 */
export async function testCalendarAccess(calendarId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const today = new Date().toISOString().slice(0, 10)
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
    const created = await createGcalEvent(calendarId, {
      summary: '[BEB Portal Test — safe to ignore]',
      description: 'Created by BEB Portal to verify Google Calendar access. This event is being deleted immediately.',
      startDate: today,
      endDate: tomorrow,
    })
    await deleteGcalEvent(calendarId, created.id)
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Unknown error' }
  }
}
