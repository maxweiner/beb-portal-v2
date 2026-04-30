// POST /api/marketing/campaigns/create
//
// Body: { event_id: string, flow_type: 'vdp' | 'postcard' | 'newspaper' }
//
// Replaces the old AFTER INSERT trigger. Campaigns are now created
// explicitly. The unique (event_id, flow_type) index in Phase 1 still
// blocks duplicates — we surface that as a friendly 409.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'

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

  const sb = admin()
  const { data: meRow } = await sb.from('users').select('marketing_access').eq('id', me.id).maybeSingle()
  if (!(meRow as any)?.marketing_access) {
    return NextResponse.json({ error: 'Marketing access required' }, { status: 403 })
  }

  let body: any
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const eventId = (body?.event_id || '').toString()
  const flowType = (body?.flow_type || '').toString()
  if (!eventId) return NextResponse.json({ error: 'Missing event_id' }, { status: 400 })
  if (!['vdp', 'postcard', 'newspaper'].includes(flowType)) {
    return NextResponse.json({ error: 'flow_type must be vdp, postcard, or newspaper' }, { status: 400 })
  }

  // Compute mail_by_date via the SQL helper (still installed; the only
  // thing the rework dropped is the trigger that called it).
  const { data: ev } = await sb.from('events').select('id, start_date').eq('id', eventId).maybeSingle()
  if (!ev) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

  const { data: mailByRow } = await sb.rpc('compute_mail_by_date', {
    p_start_date: ev.start_date,
    p_flow: flowType,
  })
  // rpc() returns the scalar directly when the function is RETURNS DATE.
  const mailBy = (mailByRow as unknown as string) || null

  const { data, error } = await sb.from('marketing_campaigns').insert({
    event_id: eventId,
    flow_type: flowType,
    mail_by_date: mailBy,
  }).select('*').single()

  if (error) {
    // Friendly duplicate message
    if (/duplicate key|unique/i.test(error.message)) {
      const { data: existing } = await sb.from('marketing_campaigns')
        .select('id').eq('event_id', eventId).eq('flow_type', flowType).maybeSingle()
      return NextResponse.json({
        error: `A ${flowType.toUpperCase()} campaign already exists for this event.`,
        existing_campaign_id: existing?.id,
      }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, campaign: data })
}
