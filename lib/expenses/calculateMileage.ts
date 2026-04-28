// Calls the Google Maps Distance Matrix API with home_address →
// store_address, doubles for round trip, applies the 10% in-town
// buffer, multiplies by the configured IRS mileage rate. Returns a
// breakdown the UI shows verbatim and persists in the expense's notes
// field for the audit trail.

import { createClient } from '@supabase/supabase-js'

const DEFAULT_IRS_RATE = 0.67       // 2025 default per spec
const IN_TOWN_BUFFER = 1.10         // 10% buffer per spec
const METERS_PER_MILE = 1609.344

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

export interface MileageBreakdown {
  homeAddress: string
  storeAddress: string
  oneWayMiles: number
  roundTripMiles: number
  bufferedMiles: number
  rate: number
  amount: number
  description: string  // human-readable line for the expense's notes field
}

async function loadIrsRate(): Promise<number> {
  const sb = admin()
  const { data } = await sb.from('settings').select('value').eq('key', 'irs_mileage_rate').maybeSingle()
  if (data?.value == null) return DEFAULT_IRS_RATE
  // settings.value is JSONB — could be a number or a stringified number.
  const raw = typeof data.value === 'number' ? data.value : Number(String(data.value).replace(/^"|"$/g, ''))
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_IRS_RATE
}

/**
 * Looks up the user's home_address + the event's store address, calls
 * Distance Matrix, returns the full breakdown. Throws on any
 * unrecoverable error (missing addresses, API failure, no route).
 */
export async function calculateMileageForReport(reportId: string): Promise<MileageBreakdown> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) throw new Error('GOOGLE_MAPS_API_KEY is not set')

  const sb = admin()
  const { data: report, error: rErr } = await sb
    .from('expense_reports').select('id, user_id, event_id').eq('id', reportId).maybeSingle()
  if (rErr || !report) throw new Error(rErr?.message ?? 'Report not found')

  const [{ data: u }, { data: ev }] = await Promise.all([
    sb.from('users').select('home_address').eq('id', report.user_id).maybeSingle(),
    sb.from('events').select('store_id').eq('id', report.event_id).maybeSingle(),
  ])
  const homeAddress = ((u as any)?.home_address ?? '').trim()
  if (!homeAddress) throw new Error('No home address on your profile. Set it in Settings → Profile.')
  if (!ev) throw new Error('Event not found for this report.')

  const { data: store } = await sb.from('stores')
    .select('address, city, state, zip, name')
    .eq('id', ev.store_id).maybeSingle()
  if (!store) throw new Error('Store not found for this event.')
  const storeAddress = [
    (store as any).address, (store as any).city, (store as any).state, (store as any).zip,
  ].filter(s => s && String(s).trim().length > 0).join(', ')
  if (!storeAddress) throw new Error('Store has no address on file.')

  const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json')
  url.searchParams.set('origins', homeAddress)
  url.searchParams.set('destinations', storeAddress)
  url.searchParams.set('units', 'imperial')
  url.searchParams.set('key', apiKey)

  const res = await fetch(url.toString())
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Distance Matrix HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  const json = await res.json() as any
  const top = json?.status
  if (top && top !== 'OK') throw new Error(`Distance Matrix: ${top} ${json?.error_message ?? ''}`)
  const elem = json?.rows?.[0]?.elements?.[0]
  if (!elem) throw new Error('Distance Matrix returned no result')
  if (elem.status !== 'OK') throw new Error(`Distance Matrix element status: ${elem.status}`)
  const meters = elem?.distance?.value
  if (typeof meters !== 'number' || !Number.isFinite(meters) || meters <= 0) {
    throw new Error('Distance Matrix returned no distance')
  }

  const oneWayMiles = round1(meters / METERS_PER_MILE)
  const roundTripMiles = round1(oneWayMiles * 2)
  const bufferedMiles = round1(roundTripMiles * IN_TOWN_BUFFER)
  const rate = await loadIrsRate()
  const amount = Math.round(bufferedMiles * rate * 100) / 100

  const description = `Home → ${(store as any).name || 'Store'}: ${oneWayMiles} mi one-way × 2 = ${roundTripMiles} mi round trip × ${IN_TOWN_BUFFER} buffer = ${bufferedMiles} mi × $${rate.toFixed(2)} = $${amount.toFixed(2)}`

  return {
    homeAddress, storeAddress,
    oneWayMiles, roundTripMiles, bufferedMiles,
    rate, amount, description,
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
