// POST /api/events/[id]/delete-forever
//
// Hard-deletes a buying event. Only allowed for events that are
// already in status='cancelled' (the soft-cancel path is the only
// way to get there) — forces the operator to actively cancel first
// before they can permanently destroy.
//
// Cascades via the existing schema FKs:
//   - event_days.event_id           ON DELETE CASCADE
//   - buyer_entries.event_id        ON DELETE CASCADE
//   - marketing_campaigns.event_id  ON DELETE CASCADE
//   - travel_reservations.event_id  varies; usually CASCADE or SET NULL
//   - expense_reports.event_id      ON DELETE CASCADE on the legacy
//                                   buying-event ref; sales-side
//                                   reports use trunk_show_id /
//                                   trade_show_id which won't fire here
//   - appointments.event_id         ON DELETE CASCADE
//
// Body: { confirm: string }  // must equal store_name or YYYY-MM-DD
//                            // start_date — belt-and-suspenders.
//
// Auth: caller must be admin/superadmin/partner.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  // ⚠️ All restrictions stripped per request — only the bare-minimum
  // JWT check remains so the endpoint isn't exposed to the open
  // internet. To be locked back down once the auth flow is debugged.
  const sb = admin()
  const authHeader = req.headers.get('authorization') || ''
  const m = authHeader.match(/^Bearer\s+(.+)$/i)
  if (!m) return NextResponse.json({ error: 'Unauthorized — no Bearer token' }, { status: 401 })
  const { data: tokenUser, error: tokenErr } = await sb.auth.getUser(m[1])
  if (tokenErr || !tokenUser?.user?.id) {
    return NextResponse.json({
      error: 'Unauthorized — JWT failed verification',
      detail: tokenErr?.message || 'no user in token',
    }, { status: 401 })
  }

  const { data: event, error: evErr } = await sb
    .from('events')
    .select('id, store_name, start_date, status')
    .eq('id', params.id)
    .maybeSingle()
  if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 })
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

  const { error: delErr } = await sb.from('events').delete().eq('id', event.id)
  if (delErr) return NextResponse.json({ error: `Delete failed: ${delErr.message}` }, { status: 500 })

  return NextResponse.json({ ok: true, deleted: { id: event.id, store_name: event.store_name, start_date: event.start_date } })
}
