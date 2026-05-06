// GET /api/appointments/store-options
//
// Powers the "force you to choose a store" dropdown in the Daily
// Appointments PDF modal. Returns:
//   - Stores that have at least one upcoming appointment (portal +
//     gcal pickup happens client-side via the existing per-store
//     iCal feed; this endpoint reports portal hits + always-include
//     stores with a calendar_feed_url so gcal-only stores like Kay
//     Cameron still show up).
//   - For each store, the distinct dates that have any portal
//     appointment, plus the latest event window (start + length)
//     so the modal can offer "All event days" mode.
//
// Filtered to a 60-day window (30 back, 30 forward) so the dropdown
// stays small. Far-future events still surface because they have
// portal-side appointments seeded ahead of time.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function GET(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = admin()

  const today = new Date(); today.setUTCHours(0, 0, 0, 0)
  const back = new Date(today); back.setUTCDate(back.getUTCDate() - 30)
  const ahead = new Date(today); ahead.setUTCDate(ahead.getUTCDate() + 60)

  // Stores with portal appointments in the window. Use !inner so we only
  // get stores that have at least one row.
  const { data: portalRows } = await sb
    .from('appointments')
    .select('store_id, appointment_date, store:stores!inner(name, city, state)')
    .gte('appointment_date', ymd(back))
    .lte('appointment_date', ymd(ahead))

  const portalDatesByStore = new Map<string, Set<string>>()
  const storeMeta = new Map<string, { name: string; city: string | null; state: string | null }>()
  for (const r of (portalRows || [])) {
    const sid = (r as any).store_id
    if (!portalDatesByStore.has(sid)) portalDatesByStore.set(sid, new Set())
    portalDatesByStore.get(sid)!.add((r as any).appointment_date)
    if (!storeMeta.has(sid)) {
      const s = (r as any).store
      storeMeta.set(sid, { name: s?.name || '(unknown)', city: s?.city ?? null, state: s?.state ?? null })
    }
  }

  // Also surface stores with a calendar_feed_url. These may have
  // gcal-only days that don't appear in the appointments table.
  const { data: feedStores } = await sb
    .from('stores')
    .select('id, name, city, state, calendar_feed_url')
    .not('calendar_feed_url', 'is', null)
  for (const s of (feedStores || [])) {
    if (!storeMeta.has(s.id)) {
      storeMeta.set(s.id, { name: s.name, city: s.city, state: s.state })
    }
  }

  // For each store, look up its most recent (or upcoming) event window
  // so the modal can populate "All event days" mode without making the
  // user pick the event.
  const storeIds = [...storeMeta.keys()]
  let eventByStore = new Map<string, { start_date: string; days: string[] }>()
  if (storeIds.length > 0) {
    const { data: events } = await sb
      .from('events')
      .select('id, store_id, start_date, days:event_days(day_date)')
      .in('store_id', storeIds)
      .gte('start_date', ymd(back))
      .lte('start_date', ymd(ahead))
      .order('start_date', { ascending: false })
    for (const e of (events || [])) {
      // Take the first (most recent) event per store. If there are
      // overlapping events, the modal's "All event days" picks the
      // newest — close enough for an immediate send.
      const sid = (e as any).store_id
      if (eventByStore.has(sid)) continue
      const eventDays = ((e as any).days || [])
        .map((d: any) => d.day_date)
        .filter(Boolean)
        .sort()
      eventByStore.set(sid, {
        start_date: (e as any).start_date,
        days: eventDays.length > 0 ? eventDays : [(e as any).start_date],
      })
    }
  }

  const stores = [...storeMeta.entries()]
    .map(([id, meta]) => ({
      id,
      name: meta.name,
      city: meta.city,
      state: meta.state,
      portal_dates: [...(portalDatesByStore.get(id) || [])].sort(),
      event_window: eventByStore.get(id) || null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return NextResponse.json({ stores })
}
