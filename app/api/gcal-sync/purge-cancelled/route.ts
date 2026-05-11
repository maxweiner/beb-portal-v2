// POST /api/gcal-sync/purge-cancelled
// Body: { brand: 'beb' | 'liberty', mode: 'preview' | 'apply' }
//
// Scans every event on the brand's Google Calendar, looks up each
// one in the DB by the portal event_id we stamped on source.url,
// and flags for deletion any Google event whose DB row is
// status='cancelled' (or whose DB row no longer exists at all —
// "orphan" rows from delete-forever cleanups).
//
// Companion to the trigger fix in
// supabase-migration-gcal-watch-status-cancelled.sql, which catches
// future cancellations + the cancelled_at backfill. This endpoint
// handles two cases the SQL backfill can't:
//   - events with status='cancelled' whose gcal_event_links row is
//     missing (the SQL backfill JOINs on links so it skips these).
//   - "orphan" Google events whose portal event was already
//     delete-forever'd.
//
// Preview returns counts + a 10-row sample. Apply deletes the
// flagged events from Google + cleans the gcal_event_links table.
//
// Auth: matches the rest of the /api/gcal-sync/* family —
// blockIfImpersonating only. The button rendering this is gated to
// superadmin client-side.

import { NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { listGcalEvents, deleteGcalEvent, type ListedGcalEvent } from '@/lib/gcal/client'
import { blockIfImpersonating } from '@/lib/impersonation/server'

export const dynamic = 'force-dynamic'

function admin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

// Same regex as the dedupe route — captures the event_id (UUID)
// from the `?event=<id>` segment of our source.url stamp. Loose on
// hostname / scheme because the portal URL has flipped across
// staging and prod hosts.
const EVENT_ID_FROM_URL = /[?&]event=([0-9a-f-]{36})\b/i

function extractEventId(sourceUrl: string | undefined): string | null {
  if (!sourceUrl) return null
  const m = sourceUrl.match(EVENT_ID_FROM_URL)
  return m ? m[1] : null
}

interface PurgeTarget {
  google_event: ListedGcalEvent
  event_id: string
  reason: 'cancelled' | 'orphan'
}

export async function POST(req: Request) {
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

  // 2. Pull every event on Google + every event_id → status from DB.
  let allGoogle: ListedGcalEvent[]
  try {
    allGoogle = await listGcalEvents(calendarId)
  } catch (e: any) {
    return NextResponse.json({ error: `List failed: ${e?.message || 'unknown'}` }, { status: 500 })
  }

  // 3. Group Google events by the portal event_id stamped in
  //    source.url. Skip cancelled (Google tombstone) rows and
  //    anything without our pattern.
  const byEventId = new Map<string, ListedGcalEvent[]>()
  let withoutSourceUrl = 0
  let tombstones = 0
  for (const ev of allGoogle) {
    if (ev.status === 'cancelled') { tombstones++; continue }
    const id = extractEventId(ev.sourceUrl)
    if (!id) { withoutSourceUrl++; continue }
    let arr = byEventId.get(id)
    if (!arr) { arr = []; byEventId.set(id, arr) }
    arr.push(ev)
  }

  // 4. Look up each portal event in the DB. We need event_id →
  //    status mapping. Pull in chunks of 500 ids per IN clause.
  const portalIds = Array.from(byEventId.keys())
  const eventStatusById = new Map<string, string | null>()
  for (let i = 0; i < portalIds.length; i += 500) {
    const chunk = portalIds.slice(i, i + 500)
    if (chunk.length === 0) continue
    const { data: rows } = await sb
      .from('events')
      .select('id, status, cancelled_at')
      .in('id', chunk)
    for (const r of (rows || []) as any[]) {
      const cancelled = r.status === 'cancelled' || r.cancelled_at != null
      eventStatusById.set(r.id, cancelled ? 'cancelled' : (r.status || 'unknown'))
    }
  }

  // 5. Build the purge target list.
  const targets: PurgeTarget[] = []
  for (const [eventId, googleEvents] of byEventId.entries()) {
    const dbStatus = eventStatusById.get(eventId)
    let reason: 'cancelled' | 'orphan' | null = null
    if (dbStatus === undefined) reason = 'orphan'         // no DB row at all
    else if (dbStatus === 'cancelled') reason = 'cancelled'
    if (!reason) continue
    for (const ge of googleEvents) {
      targets.push({ google_event: ge, event_id: eventId, reason })
    }
  }

  const sample = targets.slice(0, 10).map(t => ({
    event_id: t.event_id,
    reason: t.reason,
    google: {
      id: t.google_event.id,
      summary: t.google_event.summary,
      startDate: t.google_event.startDate,
    },
  }))

  const cancelledCount = targets.filter(t => t.reason === 'cancelled').length
  const orphanCount    = targets.filter(t => t.reason === 'orphan').length

  const preview = {
    calendar_total_events:  allGoogle.length,
    tombstones_skipped:     tombstones,
    events_without_our_url: withoutSourceUrl,
    portal_event_groups:    byEventId.size,
    to_delete:              targets.length,
    cancelled_in_db:        cancelledCount,
    orphan_in_db:           orphanCount,
    sample,
  }

  if (mode === 'preview') {
    return NextResponse.json({ ok: true, mode: 'preview', ...preview })
  }

  // ── apply ───────────────────────────────────────────────────
  let deleted = 0
  const deleteErrors: { id: string; error: string }[] = []
  // Track per-portal-event so we can clean gcal_event_links once
  // ALL google events for that portal id have been deleted.
  const purgedEventIds = new Set<string>()
  for (const t of targets) {
    try {
      await deleteGcalEvent(calendarId, t.google_event.id)
      deleted++
      purgedEventIds.add(t.event_id)
    } catch (e: any) {
      deleteErrors.push({ id: t.google_event.id, error: e?.message || 'unknown' })
    }
  }

  // Sweep gcal_event_links for the portal ids we purged. Delete
  // any link rows that point at a now-removed Google event. We
  // don't blindly nuke the whole row for a portal id because
  // there could still be a "winner" google event left (e.g. one
  // we wanted to keep that didn't get included in this purge).
  if (purgedEventIds.size > 0) {
    const ids = Array.from(purgedEventIds)
    // For each purged portal event, check whether any of the
    // google events that *survived* match the existing link. If
    // the link points at a deleted event, drop it.
    const purgedGoogleIds = new Set(targets.map(t => t.google_event.id))
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500)
      const { data: links } = await sb
        .from('gcal_event_links')
        .select('event_id, google_calendar_event_id')
        .in('event_id', chunk)
      for (const lk of (links || []) as any[]) {
        if (purgedGoogleIds.has(lk.google_calendar_event_id)) {
          await sb.from('gcal_event_links').delete().eq('event_id', lk.event_id)
        }
      }
    }
  }

  return NextResponse.json({
    ok: true,
    mode: 'apply',
    ...preview,
    deleted,
    delete_errors: deleteErrors,
  })
}
