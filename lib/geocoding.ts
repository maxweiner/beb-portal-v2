// Server-side geocoding via Google Geocoding API. Used by:
//   - the travel-match backfill (PR 2) to populate stores.lat/lon
//   - the inbound-travel-email handler (PR 3) to geocode hotel
//     addresses parsed by Claude
//
// Reads GOOGLE_MAPS_API_KEY (server-side); falls back to
// NEXT_PUBLIC_GOOGLE_MAPS_API_KEY which is already wired for the
// address-autocomplete widget. Server-side calls don't need the
// NEXT_PUBLIC_ prefix but we accept it for env parity.
//
// Returns null on:
//   - missing/blank address
//   - API key not configured
//   - Google response other than OK / ZERO_RESULTS
//   - any network/parse error
//
// Callers should treat null as "couldn't geocode, skip the
// distance check" rather than as a hard failure.

export interface GeocodeResult {
  lat: number
  lon: number
  formatted_address: string
}

export async function geocodeAddress(address: string | null | undefined): Promise<GeocodeResult | null> {
  const a = (address || '').trim()
  if (!a) return null

  const key = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  if (!key) return null

  try {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
    url.searchParams.set('address', a)
    url.searchParams.set('key', key)

    const res = await fetch(url.toString(), { method: 'GET' })
    if (!res.ok) return null
    const data: any = await res.json()

    if (data.status !== 'OK' || !Array.isArray(data.results) || data.results.length === 0) {
      return null
    }

    const top = data.results[0]
    const loc = top?.geometry?.location
    if (typeof loc?.lat !== 'number' || typeof loc?.lng !== 'number') return null

    return {
      lat: loc.lat,
      lon: loc.lng,
      formatted_address: top.formatted_address || a,
    }
  } catch {
    return null
  }
}

// Haversine distance between two lat/lon pairs, in miles.
// Returns Infinity if either input is null — callers can treat
// missing coords as "out of range" so they don't accidentally pass
// the radius check.
export function distanceMiles(
  a: { lat: number | null | undefined; lon: number | null | undefined },
  b: { lat: number | null | undefined; lon: number | null | undefined },
): number {
  if (a.lat == null || a.lon == null || b.lat == null || b.lon == null) return Infinity
  const R = 3958.7613    // Earth radius in miles
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}
