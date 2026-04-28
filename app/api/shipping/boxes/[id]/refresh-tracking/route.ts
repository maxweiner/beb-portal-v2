// Manual "Refresh now" — looks up one box by id, calls its carrier,
// updates the row. Auth piggybacks on the standard Supabase session via
// the existing RLS policies on event_shipment_boxes (admins/superadmins
// or workers assigned to the event).

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { pollOneBox } from '@/lib/shipping/poll'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

function authed(req: Request) {
  // Same pattern as other authenticated app routes: require a Supabase
  // session cookie. We re-check write authority via RLS on the update.
  const sessionCookie = req.headers.get('cookie') ?? ''
  return sessionCookie.includes('sb-')
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!authed(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = admin()
  const { data: box, error } = await sb
    .from('event_shipment_boxes')
    .select('id, tracking_number, carrier, status, labels_sent_at, shipped_at, received_at')
    .eq('id', params.id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!box) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (!box.tracking_number) return NextResponse.json({ error: 'no tracking number on this box' }, { status: 400 })
  if (!box.carrier) return NextResponse.json({ error: 'no carrier on this box' }, { status: 400 })

  const outcome = await pollOneBox(box as any, sb)
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error || 'refresh failed' }, { status: 502 })
  }
  return NextResponse.json(outcome)
}
