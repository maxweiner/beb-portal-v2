// POST /api/gcal-sync/full
// Body: { brand: 'beb' | 'liberty' }
//
// Enqueues a 'create' (or 'update' if a link already exists) for every event
// in the brand. The cron worker drains them on its normal schedule. We don't
// run the dispatcher inline — keeps the request fast and avoids a hot loop
// when the brand has hundreds of events.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { blockIfImpersonating } from '@/lib/impersonation/server'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function POST(req: Request) {
  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const brand = body?.brand
  if (brand !== 'beb' && brand !== 'liberty') {
    return NextResponse.json({ error: 'brand must be beb or liberty' }, { status: 400 })
  }

  const sb = admin()

  // Pull all events for the brand and the existing link map in parallel.
  const [evRes, linkRes] = await Promise.all([
    sb.from('events').select('id, brand, store_id, store_name, start_date, workers').eq('brand', brand),
    sb.from('gcal_event_links').select('event_id, google_calendar_event_id').eq('brand', brand),
  ])
  const events = (evRes.data || []) as any[]
  const linkMap = new Map<string, string>(
    ((linkRes.data || []) as any[]).map(l => [l.event_id, l.google_calendar_event_id]),
  )

  if (events.length === 0) {
    return NextResponse.json({ ok: true, enqueued: 0, message: 'No events for this brand.' })
  }

  // Insert one queue row per event in a single batched insert.
  const rows = events.map(ev => {
    const linkId = linkMap.get(ev.id)
    return {
      event_id: ev.id,
      brand: ev.brand,
      action: linkId ? 'update' : 'create',
      google_calendar_event_id: linkId || null,
      payload: {
        store_id: ev.store_id,
        store_name: ev.store_name,
        start_date: ev.start_date,
        workers: ev.workers || [],
      },
      status: 'pending',
    }
  })

  // Insert in chunks of 500 to stay under any per-request limits.
  let total = 0
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    const { error } = await sb.from('gcal_sync_queue').insert(chunk)
    if (error) return NextResponse.json({ error: error.message, enqueued: total }, { status: 500 })
    total += chunk.length
  }

  await sb.from('gcal_integration_settings')
    .update({ last_full_sync_at: new Date().toISOString() })
    .eq('brand', brand)

  return NextResponse.json({ ok: true, enqueued: total })
}
