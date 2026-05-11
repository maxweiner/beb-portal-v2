// POST /api/gcal-adhoc/events
// Body: {
//   title: string                     (required)
//   start_date: 'YYYY-MM-DD'         (required)
//   end_date?: 'YYYY-MM-DD' | null    (single-day if omitted)
//   description?: string
//   location?: string
//   target_calendar_id: string        (required)
//   target_label: string              (required, for display)
// }
//
// Creates a portal row, pushes to Google Calendar synchronously,
// stores the resulting google_calendar_event_id. If Google fails we
// don't insert — the user retries.
//
// Superadmin only.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { blockIfImpersonating } from '@/lib/impersonation/server'
import { createGcalEvent } from '@/lib/gcal/client'
import { portalAdHocUrlFor } from '@/lib/gcal/adhoc'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

// All-day events on Google use an EXCLUSIVE end date. The portal
// stores inclusive `end_date`, so we shift forward by one day when
// pushing. Single-day events (no end_date) become start + 1 day.
function toExclusiveEnd(start: string, endInclusive: string | null): string {
  const base = endInclusive || start
  const d = new Date(base + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export async function POST(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (me.role !== 'superadmin') {
    return NextResponse.json({ error: 'Superadmin required' }, { status: 403 })
  }
  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const title       = String(body?.title || '').trim()
  const start_date  = String(body?.start_date || '').trim()
  const end_date    = body?.end_date ? String(body.end_date).trim() : null
  const description = body?.description != null ? String(body.description) : null
  const location    = body?.location != null ? String(body.location) : null
  const target_calendar_id = String(body?.target_calendar_id || '').trim()
  const target_label       = String(body?.target_label || '').trim()

  if (!title) return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date)) return NextResponse.json({ error: 'start_date must be YYYY-MM-DD' }, { status: 400 })
  if (end_date && !/^\d{4}-\d{2}-\d{2}$/.test(end_date)) return NextResponse.json({ error: 'end_date must be YYYY-MM-DD' }, { status: 400 })
  if (end_date && end_date < start_date) return NextResponse.json({ error: 'end_date cannot be before start_date' }, { status: 400 })
  if (!target_calendar_id) return NextResponse.json({ error: 'target_calendar_id is required' }, { status: 400 })

  const sb = admin()

  // 1. Insert the portal row first (without google id) so we have a
  //    UUID to stamp on the Google event's source.url. That makes
  //    future dedupes / lookups straightforward.
  const { data: created, error: insErr } = await sb
    .from('gcal_adhoc_events')
    .insert({
      title,
      start_date,
      end_date,
      description: description || null,
      location: location || null,
      target_calendar_id,
      target_label: target_label || target_calendar_id,
      created_by: me.id,
    })
    .select('*')
    .single()
  if (insErr || !created) {
    return NextResponse.json({ error: insErr?.message || 'Insert failed' }, { status: 500 })
  }
  const adhocId = (created as any).id as string

  // 2. Push to Google. If it fails, hard-delete the portal row so
  //    we don't leave an orphan record the user can't repair from
  //    the UI.
  try {
    const gcal = await createGcalEvent(target_calendar_id, {
      summary: title,
      description: description || '',
      location: location || '',
      startDate: start_date,
      endDate: toExclusiveEnd(start_date, end_date),
      source: { title: 'BEB Portal', url: portalAdHocUrlFor(adhocId) },
    })
    const { data: updated, error: updErr } = await sb
      .from('gcal_adhoc_events')
      .update({ google_calendar_event_id: gcal.id, updated_at: new Date().toISOString() })
      .eq('id', adhocId)
      .select('*')
      .single()
    if (updErr) throw new Error(updErr.message)
    return NextResponse.json({ ok: true, event: updated })
  } catch (e: any) {
    await sb.from('gcal_adhoc_events').delete().eq('id', adhocId)
    return NextResponse.json({ error: `Google push failed: ${e?.message || 'unknown'}` }, { status: 502 })
  }
}

// GET /api/gcal-adhoc/events
// Lists every ad-hoc event the calling superadmin can see (RLS-
// scoped). Ordered by start_date ascending so upcoming entries
// sort to the top.
export async function GET(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (me.role !== 'superadmin') {
    return NextResponse.json({ error: 'Superadmin required' }, { status: 403 })
  }

  const sb = admin()
  const { data, error } = await sb
    .from('gcal_adhoc_events')
    .select('*')
    .order('start_date', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, events: data || [] })
}
