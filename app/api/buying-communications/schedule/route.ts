// POST /api/buying-communications/schedule
//
// Creates a buying_communication_sends row in delivery_status=
// 'scheduled' with scheduled_for set. The every-15-min cron at
// /api/cron/buying-comms-fire-due drains due rows and fires them
// through the same Resend path the immediate-send route uses.
//
// Body:
//   {
//     event_id, template_id,
//     subject, body,                  // already merged
//     to_email, to_name?,
//     cc_user_ids?: string[],
//     scheduled_for: ISO datetime     // when to fire (UTC or with offset)
//   }
//
// Auth: admin / superadmin / partner. NO kill-switch gate here —
// scheduling doesn't actually send. The cron worker enforces the
// kill switch when it tries to fire the row.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
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
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  const isAdmin = me.role === 'admin' || me.role === 'superadmin' || !!me.is_partner
  if (!isAdmin) return NextResponse.json({ error: 'Admin/partner only' }, { status: 403 })

  if (!me.email || !/@bebllp\.com$/i.test(me.email)) {
    return NextResponse.json({
      error: `Sender's email (${me.email}) is not @bebllp.com — scheduling refused so the cron doesn't bounce on send.`,
    }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const event_id      = String(body.event_id    || '')
  const template_id   = String(body.template_id || '')
  const subject       = String(body.subject     || '').trim()
  const bodyText      = String(body.body        || '').trim()
  const to_email      = String(body.to_email    || '').trim()
  const to_name       = body.to_name ? String(body.to_name) : null
  const scheduled_for = String(body.scheduled_for || '').trim()
  const cc_user_ids: string[] = Array.isArray(body.cc_user_ids)
    ? body.cc_user_ids.filter((x: any) => typeof x === 'string')
    : []

  if (!event_id || !template_id) return NextResponse.json({ error: 'event_id and template_id required' }, { status: 400 })
  if (!subject || !bodyText)      return NextResponse.json({ error: 'subject and body required' }, { status: 400 })
  if (!to_email)                  return NextResponse.json({ error: 'to_email required' }, { status: 400 })
  if (!scheduled_for)             return NextResponse.json({ error: 'scheduled_for required' }, { status: 400 })

  // Validate the schedule timestamp. Refuse anything in the past
  // — the cron only forward-scans.
  const when = new Date(scheduled_for)
  if (Number.isNaN(when.getTime())) {
    return NextResponse.json({ error: 'scheduled_for is not a valid timestamp' }, { status: 400 })
  }
  if (when.getTime() <= Date.now()) {
    return NextResponse.json({ error: 'scheduled_for must be in the future' }, { status: 400 })
  }

  const sb = admin()

  // Resolve CC emails (same pattern as the immediate-send route).
  let cc_emails: string[] = []
  if (cc_user_ids.length > 0) {
    const { data: ccUsers } = await sb.from('users')
      .select('email').in('id', cc_user_ids)
    cc_emails = ((ccUsers || []) as any[])
      .map(u => (u.email || '').trim())
      .filter((e: string) => e && e.includes('@'))
  }

  const { data: row, error } = await sb
    .from('buying_communication_sends')
    .insert({
      event_id,
      template_id,
      sent_by_user_id:       me.id,
      from_email:            me.email,
      from_name:             me.name || me.email,
      to_email,
      to_name,
      cc_emails,
      subject_line_rendered: subject,
      body_rendered:         bodyText,
      delivery_status:       'scheduled',
      scheduled_for:         when.toISOString(),
      scheduled_by_user_id:  me.id,
      scheduled_at:          new Date().toISOString(),
      sent_at:               null,
    })
    .select('id, scheduled_for')
    .single()

  if (error || !row) {
    return NextResponse.json({ error: error?.message || 'Schedule write failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, send_id: row.id, scheduled_for: row.scheduled_for })
}
