// PATCH /api/gcal-adhoc/events/[id]
//   Body: any subset of { title, start_date, end_date, description,
//                         location } — target_calendar_id is NOT
//   editable post-create (would require deleting from one calendar
//   and creating on another; skipped for v1, low-frequency need).
//
// DELETE /api/gcal-adhoc/events/[id]
//   Removes from Google + hard-deletes the portal row.
//
// Superadmin only.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { blockIfImpersonating } from '@/lib/impersonation/server'
import { patchGcalEvent, deleteGcalEvent } from '@/lib/gcal/client'
import { portalAdHocUrlFor } from '@/lib/gcal/adhoc'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

function toExclusiveEnd(start: string, endInclusive: string | null): string {
  const base = endInclusive || start
  const d = new Date(base + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

async function gateSuperadmin(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (me.role !== 'superadmin') {
    return { error: NextResponse.json({ error: 'Superadmin required' }, { status: 403 }) }
  }
  const blocked = await blockIfImpersonating(req)
  if (blocked) return { error: blocked }
  return { me }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const g = await gateSuperadmin(req)
  if ('error' in g) return g.error

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const sb = admin()
  const { data: current, error: loadErr } = await sb
    .from('gcal_adhoc_events').select('*').eq('id', params.id).maybeSingle()
  if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 })
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Compose the post-patch state for validation + Google push.
  const next = {
    title:       body.title       != null ? String(body.title).trim()       : (current as any).title,
    start_date:  body.start_date  != null ? String(body.start_date).trim()  : (current as any).start_date,
    end_date:    body.end_date    !== undefined ? (body.end_date ? String(body.end_date).trim() : null) : (current as any).end_date,
    description: body.description !== undefined ? (body.description != null ? String(body.description) : null) : (current as any).description,
    location:    body.location    !== undefined ? (body.location    != null ? String(body.location)    : null) : (current as any).location,
  }

  if (!next.title) return NextResponse.json({ error: 'Title cannot be empty' }, { status: 400 })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(next.start_date)) return NextResponse.json({ error: 'start_date must be YYYY-MM-DD' }, { status: 400 })
  if (next.end_date && !/^\d{4}-\d{2}-\d{2}$/.test(next.end_date)) return NextResponse.json({ error: 'end_date must be YYYY-MM-DD' }, { status: 400 })
  if (next.end_date && next.end_date < next.start_date) return NextResponse.json({ error: 'end_date cannot be before start_date' }, { status: 400 })

  // Push to Google first. If they don't have a google id (which
  // shouldn't normally happen), create instead of patch.
  const gcalId: string | null = (current as any).google_calendar_event_id || null
  if (gcalId) {
    try {
      await patchGcalEvent((current as any).target_calendar_id, gcalId, {
        summary: next.title,
        description: next.description || '',
        location: next.location || '',
        startDate: next.start_date,
        endDate: toExclusiveEnd(next.start_date, next.end_date),
        source: { title: 'BEB Portal', url: portalAdHocUrlFor(params.id) },
      })
    } catch (e: any) {
      return NextResponse.json({ error: `Google patch failed: ${e?.message || 'unknown'}` }, { status: 502 })
    }
  }

  const { data: updated, error: updErr } = await sb
    .from('gcal_adhoc_events')
    .update({ ...next, updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .select('*')
    .single()
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
  return NextResponse.json({ ok: true, event: updated })
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const g = await gateSuperadmin(req)
  if ('error' in g) return g.error

  const sb = admin()
  const { data: current, error: loadErr } = await sb
    .from('gcal_adhoc_events').select('*').eq('id', params.id).maybeSingle()
  if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 })
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Remove from Google (404/410 treated as success by the client
  // helper). If Google fails with anything else we keep the portal
  // row so the operator can retry — better than orphaning the
  // calendar entry.
  const gcalId: string | null = (current as any).google_calendar_event_id || null
  if (gcalId) {
    try {
      await deleteGcalEvent((current as any).target_calendar_id, gcalId)
    } catch (e: any) {
      return NextResponse.json({ error: `Google delete failed: ${e?.message || 'unknown'}` }, { status: 502 })
    }
  }

  const { error: delErr } = await sb.from('gcal_adhoc_events').delete().eq('id', params.id)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
