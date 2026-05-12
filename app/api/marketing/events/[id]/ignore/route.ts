// POST /api/marketing/events/[id]/ignore
//
// Toggles events.marketing_ignored_at for the given event. When set,
// the event is hidden from the marketing New Campaign modal's event
// picker (and any future "events needing a campaign" surface).
// Does NOT affect any other surface — buying calendar, daily
// briefing, reports, event detail all show the event normally.
//
// Body: { ignored: boolean }
//   true  → set marketing_ignored_at = now()
//   false → clear marketing_ignored_at (restore)
//
// Auth: admin / superadmin / partner.

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

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  const allowed = me.role === 'admin' || me.role === 'superadmin' || !!me.is_partner
  if (!allowed) return NextResponse.json({ error: 'Forbidden — admin / superadmin / partner only' }, { status: 403 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (typeof body?.ignored !== 'boolean') {
    return NextResponse.json({ error: 'Body must include { ignored: boolean }' }, { status: 400 })
  }

  const sb = admin()
  const { data: ev, error: lookupErr } = await sb
    .from('events')
    .select('id')
    .eq('id', params.id)
    .maybeSingle()
  if (lookupErr) return NextResponse.json({ error: lookupErr.message }, { status: 500 })
  if (!ev) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

  const { error: updErr } = await sb
    .from('events')
    .update({
      marketing_ignored_at: body.ignored ? new Date().toISOString() : null,
    })
    .eq('id', params.id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, ignored: body.ignored })
}
