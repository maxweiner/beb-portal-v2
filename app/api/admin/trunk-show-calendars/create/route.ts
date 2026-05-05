// POST /api/admin/trunk-show-calendars/create
//
// Body: { user_id: string }
//
// Admin/superadmin/partner only. Creates a Google Calendar owned by
// the portal's service account, sets ACL to public-read so the rep
// can subscribe without authenticating, and stores the calendar id +
// subscribe URL on the user row.
//
// Idempotent: if the user already has a trunk_show_calendar_id,
// returns the existing values without creating another calendar.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { blockIfImpersonating } from '@/lib/impersonation/server'
import { createCalendar, setCalendarPublicReadOnly } from '@/lib/gcal/client'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

function subscribeUrlFor(calendarId: string): string {
  // Google's "Add to Calendar" link. Clicking it in a browser logged
  // into Google opens the rep's calendar with an "Add" prompt.
  return `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(calendarId)}`
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
  if (!userId) return NextResponse.json({ error: 'user_id required' }, { status: 400 })

  const sb = admin()
  const { data: target, error: lookupErr } = await sb
    .from('users')
    .select('id, name, email, is_trunk_rep, trunk_show_calendar_id, trunk_show_calendar_subscribe_url')
    .eq('id', userId)
    .maybeSingle()
  if (lookupErr || !target) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }
  if (!target.is_trunk_rep) {
    return NextResponse.json({ error: 'User is not flagged as a trunk-show rep' }, { status: 400 })
  }

  // Idempotent — return existing if one already exists.
  if (target.trunk_show_calendar_id) {
    return NextResponse.json({
      already_existed: true,
      calendar_id: target.trunk_show_calendar_id,
      subscribe_url: target.trunk_show_calendar_subscribe_url,
    })
  }

  // 1. Create the calendar in Google.
  let calendarId: string
  try {
    const created = await createCalendar({
      summary: `${target.name} — Trunk Shows`,
      description: `Trunk shows assigned to ${target.name}. Synced from BEB Portal.`,
    })
    calendarId = created.id
  } catch (e: any) {
    return NextResponse.json({ error: `Calendar create failed: ${e?.message || e}` }, { status: 502 })
  }

  // 2. Make it publicly readable so the rep can subscribe.
  try {
    await setCalendarPublicReadOnly(calendarId)
  } catch (e: any) {
    // Calendar exists but ACL failed — surface the error so we can
    // re-attempt or set the ACL manually. The calendar id is still
    // in Google but won't be saved to the user row, so /create can
    // be retried (it'll create a second calendar — operator can
    // delete the first via Google UI). Trade-off: rather no orphaned
    // half-set-up rows on the user.
    return NextResponse.json({
      error: `ACL grant failed (calendar ${calendarId} created but not made public): ${e?.message || e}`,
    }, { status: 502 })
  }

  const subscribeUrl = subscribeUrlFor(calendarId)

  // 3. Save to the user row.
  const { error: saveErr } = await sb
    .from('users')
    .update({
      trunk_show_calendar_id: calendarId,
      trunk_show_calendar_subscribe_url: subscribeUrl,
    })
    .eq('id', userId)
  if (saveErr) {
    return NextResponse.json({
      error: `Calendar created (${calendarId}) but DB save failed: ${saveErr.message}`,
    }, { status: 500 })
  }

  return NextResponse.json({
    already_existed: false,
    calendar_id: calendarId,
    subscribe_url: subscribeUrl,
  })
}
