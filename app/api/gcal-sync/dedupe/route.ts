// POST /api/gcal-sync/dedupe
// Body: { brand: 'beb' | 'liberty', mode: 'preview' | 'apply' }
//
// Lists every event on the brand's Google Calendar, groups them by
// the `source.url` we stamped on each event when we created it
// (shape: `${portalUrl()}/?event=${event_id}`), and for any group
// that has more than one calendar event, picks a "winner" and
// flags the rest for deletion.
//
// Winner selection — in order of preference:
//   1. The event whose Google ID matches gcal_event_links for that
//      portal event. That's the canonical link the dispatcher uses
//      for updates / deletes, so keeping it avoids the link going
//      stale.
//   2. If no link row exists OR the linked event isn't in the
//      Google response, the most recently created event in the
//      group. Most-recent ≈ best chance of matching the latest
//      portal state, since each duplicate was created in order.
//
// mode='preview' returns counts + a sample of what would be
// deleted, with no mutations. mode='apply' actually deletes the
// losers and updates gcal_event_links to point at the winner.
//
// Events without a source.url matching our portal pattern are
// left alone — we don't risk deleting events that weren't created
// by this app.
//
// Auth: caller must be a superadmin. Mirrors the gcal-sync/full
// auth model.

import { NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { listGcalEvents, deleteGcalEvent, type ListedGcalEvent } from '@/lib/gcal/client'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { blockIfImpersonating } from '@/lib/impersonation/server'

export const dynamic = 'force-dynamic'

function admin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

// Match the source.url we stamp on every event we create. Captures
// the event_id (a UUID) from the query string. Lenient on the
// hostname / scheme because portal URL has flipped between
// staging and prod hosts over the lifetime of the app, and we
// don't want to miss old events on a stale source.url base.
const EVENT_ID_FROM_URL = /[?&]event=([0-9a-f-]{36})\b/i

function extractEventId(sourceUrl: string | undefined): string | null {
  if (!sourceUrl) return null
  const m = sourceUrl.match(EVENT_ID_FROM_URL)
  return m ? m[1] : null
}

interface DupeGroup {
  event_id: string
  winner: ListedGcalEvent
  losers: ListedGcalEvent[]
}

export async function POST(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (me.role !== 'superadmin') {
    return NextResponse.json({ error: 'Forbidden — superadmins only' }, { status: 403 })
  }
  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const brand = body?.brand
  const mode = body?.mode === 'apply' ? 'apply' : 'preview'
  if (brand !== 'beb' && brand !== 'liberty') {
    return NextResponse.json({ error: 'brand must be beb or liberty' }, { status: 400 })
  }

  const sb = admin()

  // 1. Resolve the brand's calendar id.
  const { data: settings } = await sb
    .from('gcal_integration_settings')
    .select('calendar_id, enabled')
    .eq('brand', brand)
    .maybeSingle()
  if (!settings || !(settings as any).calendar_id) {
    return NextResponse.json({ error: 'No calendar configured for this brand' }, { status: 400 })
  }
  const calendarId: string = (settings as any).calendar_id

  // 2. Pull every event from Google + every link from the DB.
  let allEvents: ListedGcalEvent[]
  try {
    allEvents = await listGcalEvents(calendarId)
  } catch (e: any) {
    return NextResponse.json({ error: `List failed: ${e?.message || 'unknown'}` }, { status: 500 })
  }
  const { data: linkRows } = await sb
    .from('gcal_event_links')
    .select('event_id, google_calendar_event_id')
    .eq('brand', brand)
  const linkedByEventId = new Map<string, string>(
    ((linkRows || []) as any[]).map(r => [r.event_id, r.google_calendar_event_id]),
  )

  // 3. Bucket events by extracted portal event_id. Anything without
  //    a parseable event_id from source.url is ignored entirely —
  //    we never delete what we didn't create.
  const byEventId = new Map<string, ListedGcalEvent[]>()
  let withoutSourceUrl = 0
  let cancelledSeen = 0
  for (const ev of allEvents) {
    if (ev.status === 'cancelled') cancelledSeen++
    const id = extractEventId(ev.sourceUrl)
    if (!id) { withoutSourceUrl++; continue }
    let arr = byEventId.get(id)
    if (!arr) { arr = []; byEventId.set(id, arr) }
    arr.push(ev)
  }

  // 4. Walk each bucket; build dupe groups. For singletons we still
  //    track whether the link row points at the right Google event
  //    so the link table heals if it had drifted.
  const dupeGroups: DupeGroup[] = []
  const linkFixOnlyForEventId = new Map<string, string>()
  for (const [eventId, evs] of byEventId.entries()) {
    // Drop already-cancelled events from the "kept" candidate pool.
    // Google keeps cancelled events around for some period; they
    // don't show on the calendar so they're effectively dupes-of-
    // nothing — but if every event in the bucket is cancelled, we
    // skip the group entirely.
    const live = evs.filter(e => e.status !== 'cancelled')
    if (live.length === 0) continue

    if (live.length === 1) {
      // Singleton in the live set — record a link-fix if the DB
      // currently points somewhere else. (No deletion happens
      // here, just a link upsert in apply mode.)
      const linked = linkedByEventId.get(eventId)
      if (linked !== live[0].id) {
        linkFixOnlyForEventId.set(eventId, live[0].id)
      }
      continue
    }

    // 2+ live events — this is a dupe group. Pick the winner.
    const linked = linkedByEventId.get(eventId)
    const linkedEvent = linked ? live.find(e => e.id === linked) : undefined
    const winner = linkedEvent || live.slice().sort((a, b) => {
      const ta = a.created ? new Date(a.created).getTime() : 0
      const tb = b.created ? new Date(b.created).getTime() : 0
      return tb - ta  // newest first
    })[0]
    const losers = live.filter(e => e.id !== winner.id)
    dupeGroups.push({ event_id: eventId, winner, losers })
  }

  const totalLosers = dupeGroups.reduce((s, g) => s + g.losers.length, 0)

  // 5. Build a preview payload either way — apply mode also returns
  //    it so the UI can confirm what got cleaned up.
  const preview = {
    calendar_total_events:   allEvents.length,
    cancelled_in_response:   cancelledSeen,
    events_without_our_url:  withoutSourceUrl,
    portal_event_groups:     byEventId.size,
    dupe_groups:             dupeGroups.length,
    losers_to_delete:        totalLosers,
    link_fix_only_count:     linkFixOnlyForEventId.size,
    sample: dupeGroups.slice(0, 10).map(g => ({
      event_id: g.event_id,
      keeping:  { id: g.winner.id, summary: g.winner.summary, startDate: g.winner.startDate, created: g.winner.created },
      deleting: g.losers.map(l => ({ id: l.id, summary: l.summary, startDate: l.startDate, created: l.created })),
    })),
  }

  if (mode === 'preview') {
    return NextResponse.json({ ok: true, mode: 'preview', ...preview })
  }

  // ── apply ───────────────────────────────────────────────────
  let deleted = 0
  let deleteErrors: { id: string; error: string }[] = []
  for (const g of dupeGroups) {
    for (const loser of g.losers) {
      try {
        await deleteGcalEvent(calendarId, loser.id)
        deleted++
      } catch (e: any) {
        deleteErrors.push({ id: loser.id, error: e?.message || 'unknown' })
      }
    }
    // After loser deletion, ensure the link points at the winner.
    await sb.from('gcal_event_links').upsert({
      event_id: g.event_id,
      brand,
      google_calendar_event_id: g.winner.id,
      updated_at: new Date().toISOString(),
    })
  }
  // Also apply the link-only fixes (no deletes needed).
  for (const [eventId, gcalId] of linkFixOnlyForEventId.entries()) {
    await sb.from('gcal_event_links').upsert({
      event_id: eventId,
      brand,
      google_calendar_event_id: gcalId,
      updated_at: new Date().toISOString(),
    })
  }

  return NextResponse.json({
    ok: true,
    mode: 'apply',
    ...preview,
    deleted,
    delete_errors: deleteErrors,
    link_fixes_applied: linkFixOnlyForEventId.size,
  })
}
