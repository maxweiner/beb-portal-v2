// POST /api/communications/schedule
//
// Schedules a trunk-comms send for a future date. The send fires at
// 9 AM in the recipient store's local timezone (resolved from the
// store's state via STATE_TZ).
//
// Body:
//   {
//     trunk_show_id, template_id,
//     subject, body,                 // already merged + edited
//     to_email, to_name?,
//     scheduled_for_date,            // YYYY-MM-DD (in store's local tz)
//     schedule_id?,                  // optional template-schedule reference
//   }
//
// Auth: same as the immediate /send endpoint — caller must be admin/
// superadmin/partner OR a sales_rep assigned to the trunk show.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { blockIfImpersonating } from '@/lib/impersonation/server'
import { nineAmInTz, tzForState } from '@/lib/communications/scheduleTime'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export async function POST(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  if (!me.email || !/@bebllp\.com$/i.test(me.email)) {
    return NextResponse.json({
      error: `Sender's email (${me.email}) is not @bebllp.com — Resend will reject the send. Update the user's email and retry.`,
    }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const trunk_show_id = String(body.trunk_show_id || '')
  const template_id   = String(body.template_id   || '')
  const subject       = String(body.subject       || '').trim()
  const bodyText      = String(body.body          || '').trim()
  const to_email      = String(body.to_email      || '').trim()
  const to_name       = body.to_name ? String(body.to_name) : null
  const schedule_id   = body.schedule_id ? String(body.schedule_id) : null
  const scheduled_for_date = String(body.scheduled_for_date || '').trim()

  if (!trunk_show_id) return NextResponse.json({ error: 'trunk_show_id is required' }, { status: 400 })
  if (!template_id)   return NextResponse.json({ error: 'template_id is required' },   { status: 400 })
  if (!subject || !bodyText) return NextResponse.json({ error: 'Subject and body are required' }, { status: 400 })
  if (!to_email) return NextResponse.json({ error: 'to_email is required' }, { status: 400 })
  if (!ISO_DATE.test(scheduled_for_date)) return NextResponse.json({ error: 'scheduled_for_date must be YYYY-MM-DD' }, { status: 400 })

  const sb = admin()

  // Auth gate: same logic as /send. Admin-like passes; sales rep
  // must be the show's assigned_rep_id or in workers.
  const isAdminLike = me.role === 'admin' || me.role === 'superadmin' || !!me.is_partner
  let allowed = isAdminLike
  if (!allowed) {
    const { data: ts } = await sb
      .from('trunk_shows')
      .select('assigned_rep_id, workers')
      .eq('id', trunk_show_id)
      .maybeSingle()
    if (ts?.assigned_rep_id === me.id) allowed = true
    if (!allowed && Array.isArray((ts as any)?.workers)) {
      allowed = (ts as any).workers.some((w: any) => w?.id === me.id)
    }
  }
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Resolve recipient tz from the store's state.
  const { data: ts2 } = await sb
    .from('trunk_shows')
    .select('store:trunk_show_stores(state)')
    .eq('id', trunk_show_id)
    .maybeSingle()
  const store = Array.isArray((ts2 as any)?.store) ? (ts2 as any).store[0] : (ts2 as any)?.store
  const state = store?.state || null
  const tz = tzForState(state)
  const scheduledForUtc = nineAmInTz(scheduled_for_date, tz)

  // Refuse to schedule in the past.
  if (scheduledForUtc.getTime() < Date.now() - 60_000) {
    return NextResponse.json({
      error: `That date already passed in ${tz}. Pick a later date.`,
    }, { status: 400 })
  }

  const { data: row, error } = await sb
    .from('communication_sends')
    .insert({
      trunk_show_id,
      template_id,
      schedule_id,
      // Audit who scheduled it. sent_by_user_id will be filled when
      // the cron worker fires the row (might be a different person
      // if the scheduler leaves the company etc).
      scheduled_by_user_id: me.id,
      scheduled_at:         new Date().toISOString(),
      scheduled_for:        scheduledForUtc.toISOString(),
      from_email:           me.email,
      from_name:            me.name || me.email,
      to_email,
      to_name,
      subject_line_rendered: subject,
      body_rendered:         bodyText,
      delivery_status:       'scheduled',
      // sent_at intentionally null until the cron fires.
    })
    .select('id, scheduled_for')
    .single()

  if (error || !row) {
    return NextResponse.json({ error: error?.message || 'Schedule failed' }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    id: row.id,
    scheduled_for: row.scheduled_for,
    timezone: tz,
  })
}
