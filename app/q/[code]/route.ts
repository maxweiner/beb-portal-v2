// /q/[code] — QR redirect + scan logger.
//
// Responsibilities:
//   1. Look up the QR by code (including soft-deleted ones — they still work
//      during the 60-day trash window).
//   2. Log the scan: device type, geo (Vercel headers), referrer, hashed IP,
//      and whether this IP has scanned this QR before.
//   3. Redirect to the appropriate booking surface, threading ?src=<code>
//      through so the booking page can pre-fill lead-source attribution.
//
// If the QR doesn't exist (or was permanently purged after 60 days), we fall
// through to a generic /book page that 404s — better than dead-linking.
// Future: if a purged QR retains its store_id we can redirect there as a
// graceful fallback.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

function bookingBaseUrl(): string {
  return process.env.NEXT_PUBLIC_BOOKING_BASE_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || 'https://beb-portal-v2.vercel.app'
}

function detectDeviceType(ua: string): 'mobile' | 'tablet' | 'desktop' | 'bot' {
  const s = ua.toLowerCase()
  if (/bot|crawl|spider|slurp|preview/i.test(s)) return 'bot'
  if (/ipad|tablet|playbook|silk/.test(s)) return 'tablet'
  if (/mobile|iphone|ipod|android.*mobile|blackberry|opera mini|iemobile/.test(s)) return 'mobile'
  if (/android/.test(s)) return 'tablet' // Android non-mobile = tablet by default
  return 'desktop'
}

function hashIp(ip: string | null): string | null {
  if (!ip) return null
  return crypto
    .createHash('sha256')
    .update(ip + (process.env.QR_IP_HASH_SALT || 'beb-portal-default-salt'))
    .digest('hex')
    .slice(0, 32)
}

function pickIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip')
}

export async function GET(req: Request, { params }: { params: { code: string } }) {
  const code = (params.code || '').trim()
  const sb = admin()
  const fallback = NextResponse.redirect(`${bookingBaseUrl()}/`, { status: 307 })

  if (!code) return fallback

  // Look up QR — include soft-deleted (deleted_at IS NOT NULL within 60 days
  // still resolves; permanently purged rows simply won't match).
  const { data: qr } = await sb
    .from('qr_codes')
    .select('id, code, type, store_id, store_group_id, lead_source, custom_label, appointment_employee_id, label, deleted_at')
    .eq('code', code)
    .maybeSingle()

  if (!qr) {
    // Could be a purged/typo'd code. Give up gracefully.
    return fallback
  }

  // ---- Log the scan (best-effort; never block the redirect) ----
  const ua = req.headers.get('user-agent') || ''
  const ip = pickIp(req)
  const ipHash = hashIp(ip)

  // Repeat detection: has this hashed IP scanned this QR before?
  let isRepeat = false
  if (ipHash) {
    const { count } = await sb
      .from('qr_scans')
      .select('id', { count: 'exact', head: true })
      .eq('qr_code_id', qr.id)
      .eq('ip_hash', ipHash)
    isRepeat = (count ?? 0) > 0
  }

  const geoCity = req.headers.get('x-vercel-ip-city')
  const geoRegion = req.headers.get('x-vercel-ip-country-region')
  const geoCountry = req.headers.get('x-vercel-ip-country')
  const geoLat = req.headers.get('x-vercel-ip-latitude')
  const geoLng = req.headers.get('x-vercel-ip-longitude')

  // Fire-and-forget — do not await; we want the redirect snappy
  sb.from('qr_scans').insert({
    qr_code_id: qr.id,
    device_type: detectDeviceType(ua),
    user_agent: ua.slice(0, 500),
    geo_city: geoCity ? decodeURIComponent(geoCity) : null,
    geo_region: geoRegion || null,
    geo_country: geoCountry || null,
    geo_lat: geoLat ? Number(geoLat) : null,
    geo_lng: geoLng ? Number(geoLng) : null,
    referrer: req.headers.get('referer') || null,
    ip_hash: ipHash,
    is_repeat: isRepeat,
  }).then(({ error }) => {
    if (error) console.error('[qr-scan log] insert failed', error)
  })

  // ---- Resolve destination ----
  if (qr.type === 'group' && qr.store_group_id) {
    const { data: group } = await sb
      .from('store_groups')
      .select('slug')
      .eq('id', qr.store_group_id)
      .maybeSingle()
    if (group?.slug) {
      return NextResponse.redirect(`${bookingBaseUrl()}/book/group/${group.slug}?src=${code}`, { status: 307 })
    }
    return fallback
  }

  // Channel / custom / employee — all redirect to a single store's booking page.
  if (qr.store_id) {
    const { data: store } = await sb
      .from('stores')
      .select('slug')
      .eq('id', qr.store_id)
      .maybeSingle()
    if (store?.slug) {
      return NextResponse.redirect(`${bookingBaseUrl()}/book/${store.slug}?src=${code}`, { status: 307 })
    }
  }

  return fallback
}
