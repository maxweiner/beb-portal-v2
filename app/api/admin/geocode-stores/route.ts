// POST /api/admin/geocode-stores
//
// Admin-only. Geocodes every public.stores row missing lat/lon
// (or with stale geocoded_at) using the Google Geocoding API.
// Idempotent — safe to run repeatedly. Used to populate the
// coordinates the inbound-travel-email matcher (PR 3) uses to
// filter candidate events by hotel-to-store distance.
//
// Body (optional): { force: boolean } — when true, also re-geocodes
// rows that already have coordinates. Default false.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { blockIfImpersonating } from '@/lib/impersonation/server'
import { geocodeAddress } from '@/lib/geocoding'

export const dynamic = 'force-dynamic'
export const maxDuration = 300    // up to 5 minutes for big batches

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

function buildAddress(s: { address_1?: string | null; city?: string | null; state?: string | null; zip?: string | null }): string {
  return [s.address_1, s.city, s.state, s.zip].filter(Boolean).join(', ').trim()
}

export async function POST(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (me.role !== 'admin' && me.role !== 'superadmin') {
    return NextResponse.json({ error: 'Admin required' }, { status: 403 })
  }
  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  if (!process.env.GOOGLE_MAPS_API_KEY && !process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) {
    return NextResponse.json({ error: 'GOOGLE_MAPS_API_KEY not configured' }, { status: 500 })
  }

  let body: any = {}
  try { body = await req.json() } catch { /* allow empty body */ }
  const force = !!body?.force

  const sb = admin()
  const query = sb.from('stores').select('id, name, address_1, city, state, zip, lat, lon')
  const { data: stores, error: selErr } = force
    ? await query
    : await query.is('lat', null)
  if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 })

  const results = { total: stores?.length || 0, geocoded: 0, skipped: 0, failed: [] as Array<{ id: string; name: string; reason: string }> }

  for (const s of stores || []) {
    const addr = buildAddress(s)
    if (!addr) {
      results.skipped++
      results.failed.push({ id: s.id, name: s.name || '(unnamed)', reason: 'no address on file' })
      continue
    }
    const r = await geocodeAddress(addr)
    if (!r) {
      results.failed.push({ id: s.id, name: s.name || '(unnamed)', reason: 'geocoder returned no result' })
      // Small delay before next call to be polite to the API.
      await new Promise(res => setTimeout(res, 50))
      continue
    }
    const { error: updErr } = await sb.from('stores')
      .update({ lat: r.lat, lon: r.lon, geocoded_at: new Date().toISOString() })
      .eq('id', s.id)
    if (updErr) {
      results.failed.push({ id: s.id, name: s.name || '(unnamed)', reason: updErr.message })
    } else {
      results.geocoded++
    }
    await new Promise(res => setTimeout(res, 50))
  }

  return NextResponse.json(results)
}
