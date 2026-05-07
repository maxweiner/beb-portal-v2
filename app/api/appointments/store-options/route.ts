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
import { parseIcal } from '@/lib/calendar'

export const dynamic = 'force-dynamic'

const ALLOWED_ICAL_HOSTS = ['calendar.google.com', 'simplybook.me', 'simplybook.it']

async function loadGcalDates(opts: {
  feedUrl: string
  offsetHours: number
  windowStart: string  // YYYY-MM-DD inclusive
  windowEnd: string    // YYYY-MM-DD inclusive
}): Promise<Set<string>> {
  const out = new Set<string>()
  let url = opts.feedUrl
  if (url.includes('%40')) url = decodeURIComponent(url)
  if (!ALLOWED_ICAL_HOSTS.some(h => url.includes(h))) return out
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'BeneficialOS-BuyerPortal/2.0', 'Accept': 'text/calendar, */*' },
      next: { revalidate: 300 },
    })
    if (!res.ok) return out
    const text = await res.text()
    if (!text.includes('BEGIN:VCALENDAR')) return out
    const offsetMs = (opts.offsetHours || 0) * 60 * 60 * 1000
    for (const a of parseIcal(text)) {
      const adj = offsetMs === 0 ? a.start : new Date(a.start.getTime() + offsetMs)
      const ymd = `${adj.getUTCFullYear()}-${String(adj.getUTCMonth() + 1).padStart(2, '0')}-${String(adj.getUTCDate()).padStart(2, '0')}`
      if (ymd >= opts.windowStart && ymd <= opts.windowEnd) out.add(ymd)
    }
  } catch {}
  return out
}

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
    .select('id, name, city, state, calendar_feed_url, calendar_offset_hours')
    .not('calendar_feed_url', 'is', null)
  const feedConfig = new Map<string, { url: string; offsetHours: number }>()
  for (const s of (feedStores || [])) {
    if (!storeMeta.has(s.id)) {
      storeMeta.set(s.id, { name: s.name, city: s.city, state: s.state })
    }
    if (s.calendar_feed_url) {
      feedConfig.set(s.id, { url: s.calendar_feed_url, offsetHours: s.calendar_offset_hours || 0 })
    }
  }

  // For each store with an iCal feed, fetch its dates so the dropdown
  // includes gcal-only days (e.g. Kay Cameron books exclusively via
  // Google Calendar — without this, those days are invisible to the
  // "Single day" picker).
  const windowStart = ymd(back)
  const windowEnd   = ymd(ahead)
  const gcalDatesByStore = new Map<string, Set<string>>()
  await Promise.all([...feedConfig.entries()].map(async ([sid, cfg]) => {
    const dates = await loadGcalDates({
      feedUrl: cfg.url,
      offsetHours: cfg.offsetHours,
      windowStart,
      windowEnd,
    })
    if (dates.size > 0) gcalDatesByStore.set(sid, dates)
  }))

  // For each store, look up its most recent (or upcoming) event window
  // so the modal can populate "All event days" mode without making the
  // user pick the event.
  //
  // We also compute two flags used by the modal's smart-default logic:
  //   - is_event_in_progress: today falls within the event's day list
  //     (or, fallback, within start_date + 7 days when day_date isn't set)
  //   - user_is_assigned: the requesting user appears in events.workers
  //     for any in-progress event at the store. Used to bias the modal
  //     toward the store the buyer is currently working on.
  const storeIds = [...storeMeta.keys()]
  const todayStr = ymd(today)
  let eventByStore = new Map<string, { start_date: string; days: string[] }>()
  const inProgressStores = new Set<string>()
  const userAssignedStores = new Set<string>()
  if (storeIds.length > 0) {
    const { data: events } = await sb
      .from('events')
      .select('id, store_id, start_date, workers, days:event_days(day_number)')
      .in('store_id', storeIds)
      .gte('start_date', ymd(back))
      .lte('start_date', ymd(ahead))
      .order('start_date', { ascending: false })
    for (const e of (events || [])) {
      const sid = (e as any).store_id
      const startDate: string = (e as any).start_date
      // Derive event-day YYYY-MM-DDs from day_number (1/2/3) +
      // start_date — event_days has no day_date column.
      const startMs = new Date(startDate + 'T12:00:00')
      const dayNumbers: number[] = ((e as any).days || [])
        .map((d: any) => Number(d.day_number))
        .filter((n: any) => Number.isFinite(n) && n >= 1)
      const eventDays = dayNumbers
        .map(n => {
          const d = new Date(startMs); d.setUTCDate(startMs.getUTCDate() + (n - 1))
          return d.toISOString().slice(0, 10)
        })
        .sort()

      // In-progress check: today appears in event_days, OR today falls
      // within start_date and start_date + 7 (fallback for events that
      // don't have event_days rows seeded yet).
      const within7 = (() => {
        const start = new Date(startDate + 'T12:00:00')
        const end = new Date(start); end.setUTCDate(start.getUTCDate() + 7)
        const t = new Date(todayStr + 'T12:00:00')
        return t >= start && t <= end
      })()
      const inProgress = (eventDays.length > 0 && eventDays.includes(todayStr)) || within7
      if (inProgress) inProgressStores.add(sid)

      // user_is_assigned: requesting user's public.users.id (me.id) is
      // listed in this event's workers JSONB — only counts if the event
      // is in-progress per the rule above.
      if (inProgress) {
        const ws = (e as any).workers
        if (Array.isArray(ws) && ws.some((w: any) => w?.id === me.id)) {
          userAssignedStores.add(sid)
        }
      }

      // Capture the most recent event window per store for the
      // "All event days" mode.
      if (!eventByStore.has(sid)) {
        eventByStore.set(sid, {
          start_date: startDate,
          days: eventDays.length > 0 ? eventDays : [startDate],
        })
      }
    }
  }

  const stores = [...storeMeta.entries()]
    .map(([id, meta]) => {
      // Union portal + gcal dates so the "Single day" dropdown surfaces
      // every day with appointments from any source. Without this,
      // gcal-only stores (e.g. Kay Cameron) only show their portal
      // appointments and the user can't pick a day that's purely
      // Google-Calendar-fed.
      const datesSet = new Set<string>([
        ...(portalDatesByStore.get(id) || []),
        ...(gcalDatesByStore.get(id) || []),
      ])
      return {
        id,
        name: meta.name,
        city: meta.city,
        state: meta.state,
        portal_dates: [...datesSet].sort(),
        event_window: eventByStore.get(id) || null,
        is_event_in_progress: inProgressStores.has(id),
        user_is_assigned: userAssignedStores.has(id),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  return NextResponse.json({ stores })
}
