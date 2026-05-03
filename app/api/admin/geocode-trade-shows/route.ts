// POST /api/admin/geocode-trade-shows
//
// Mirror of /api/admin/geocode-stores but for trade_shows. Admin
// only. Geocodes any trade_show row missing lat/lon (or all rows
// when body.force=true) using the Google Geocoding API. Idempotent.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { blockIfImpersonating } from '@/lib/impersonation/server'
import { geocodeAddress } from '@/lib/geocoding'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

function buildAddress(t: { venue_address?: string | null; venue_city?: string | null; venue_state?: string | null; venue_name?: string | null }): string {
  const lead = t.venue_address || t.venue_name || ''
  return [lead, t.venue_city, t.venue_state].filter(Boolean).join(', ').trim()
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
  const query = sb.from('trade_shows').select('id, name, venue_name, venue_address, venue_city, venue_state, lat, lon').is('deleted_at', null)
  const { data: rows, error: selErr } = force
    ? await query
    : await query.is('lat', null)
  if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 })

  const results = { total: rows?.length || 0, geocoded: 0, skipped: 0, failed: [] as Array<{ id: string; name: string; reason: string }> }

  for (const t of rows || []) {
    const addr = buildAddress(t)
    const label = (t as any).name || '(unnamed)'
    if (!addr) {
      results.skipped++
      results.failed.push({ id: t.id, name: label, reason: 'no venue address on file' })
      continue
    }
    const r = await geocodeAddress(addr)
    if (!r) {
      results.failed.push({ id: t.id, name: label, reason: 'geocoder returned no result' })
      await new Promise(res => setTimeout(res, 50))
      continue
    }
    const { error: updErr } = await sb.from('trade_shows')
      .update({ lat: r.lat, lon: r.lon, geocoded_at: new Date().toISOString() })
      .eq('id', t.id)
    if (updErr) results.failed.push({ id: t.id, name: label, reason: updErr.message })
    else results.geocoded++
    await new Promise(res => setTimeout(res, 50))
  }

  return NextResponse.json(results)
}
