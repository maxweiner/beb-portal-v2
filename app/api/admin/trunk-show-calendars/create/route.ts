// POST /api/admin/trunk-show-calendars/create
//
// Body: { user_id: string, ical_url: string }    (set)
//   OR  { user_id: string, ical_url: ''  }        (clear)
//
// Previously this route auto-provisioned a Google Calendar via the
// service account. As of May 2026 the operator (Max) creates and
// owns each rep's calendar in their own Google account, shares it
// with the service account for write access, then pastes the
// calendar's "Secret address in iCal format" into the admin UI.
//
// This endpoint:
//   1. Parses the iCal URL → Calendar ID
//   2. Tests write access via createGcalEvent + deleteGcalEvent
//      (catches "you forgot to share with the service account")
//   3. Saves both Calendar ID + iCal URL to the user row
//
// To clear an existing calendar (e.g. swapping for a new one),
// send `ical_url: ''`. The route nulls both fields.
//
// Admin / superadmin / partner only.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { blockIfImpersonating } from '@/lib/impersonation/server'
import { testCalendarAccess } from '@/lib/gcal/client'
import { parseICalUrl } from '@/lib/gcal/parseICalUrl'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function POST(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const isAdmin = me.role === 'admin' || me.role === 'superadmin'
  const isPartner = !!(me as any).is_partner
  if (!isAdmin && !isPartner) {
    return NextResponse.json({ error: 'Admin or partner required' }, { status: 403 })
  }
  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  const body = await req.json().catch(() => ({}))
  const userId = String(body.user_id || '')
  const icalUrlRaw = body.ical_url !== undefined ? String(body.ical_url || '') : null
  if (!userId) return NextResponse.json({ error: 'user_id required' }, { status: 400 })

  const sb = admin()
  const { data: target, error: lookupErr } = await sb
    .from('users')
    .select('id, name, email, is_trunk_rep')
    .eq('id', userId)
    .maybeSingle()
  if (lookupErr || !target) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }
  if (!target.is_trunk_rep) {
    return NextResponse.json({ error: 'User is not flagged as a trunk-show rep' }, { status: 400 })
  }

  // ── Clear path ──────────────────────────────────────────────
  if (icalUrlRaw !== null && icalUrlRaw.trim() === '') {
    const { error: clearErr } = await sb
      .from('users')
      .update({
        trunk_show_calendar_id: null,
        trunk_show_calendar_subscribe_url: null,
      })
      .eq('id', userId)
    if (clearErr) return NextResponse.json({ error: clearErr.message }, { status: 500 })
    return NextResponse.json({ ok: true, cleared: true })
  }

  // ── Set path ────────────────────────────────────────────────
  const parsed = parseICalUrl(icalUrlRaw || '')
  if (!parsed) {
    return NextResponse.json({
      error: 'That doesn\'t look like a Google "Secret address in iCal format" URL. Open Google Calendar → Settings → pick the calendar → "Integrate calendar" → copy the field labelled "Secret address in iCal format".',
    }, { status: 400 })
  }

  // Test write access — catches "forgot to share with service
  // account" before we save the row. Creates + deletes a tiny
  // event; the operator may see it briefly on the calendar.
  const check = await testCalendarAccess(parsed.calendarId)
  if (!check.ok) {
    return NextResponse.json({
      error: `Couldn't write to that calendar: ${check.error}. Make sure you shared the calendar with our service account (role: "Make changes to events"). The service-account email is in the GOOGLE_SERVICE_ACCOUNT_JSON env var (client_email).`,
    }, { status: 502 })
  }

  const { error: saveErr } = await sb
    .from('users')
    .update({
      trunk_show_calendar_id: parsed.calendarId,
      trunk_show_calendar_subscribe_url: parsed.icalUrl,
    })
    .eq('id', userId)
  if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 })

  return NextResponse.json({
    ok: true,
    calendar_id: parsed.calendarId,
    subscribe_url: parsed.icalUrl,
  })
}
