// PUT /api/travel-reservations/:id/assign
//
// Body (any subset):
//   { buyer_id?: string | null,
//     event_id?: string | null,
//     trade_show_id?: string | null }
//
// Reassigns a travel reservation. Three independent dimensions:
//   - buyer_id        — who owns the reservation
//   - event_id        — which buying event it belongs to
//   - trade_show_id   — which trade show it belongs to
// event_id and trade_show_id are mutually exclusive (DB-enforced).
//
// When a buyer is calling this to place an unassigned reservation
// on an event or trade show, the change is appended to
// travel_reservation_assignments so a future Claude job can mine
// the patterns and suggest auto-match rules.

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

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  if (!params.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const sb = admin()

  // Load the reservation so we can: (1) honor RLS-style ownership
  // (only the buyer or an admin/superadmin can move it) and (2)
  // capture the parsed signals into the assignment log.
  const { data: existing, error: loadErr } = await sb.from('travel_reservations')
    .select('id, buyer_id, vendor, details, check_in, departure_at')
    .eq('id', params.id).maybeSingle()
  if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 })
  if (!existing) return NextResponse.json({ error: 'Reservation not found' }, { status: 404 })

  const isAdmin = me.role === 'admin' || me.role === 'superadmin'
  const isOwner = existing.buyer_id && existing.buyer_id === me.id
  if (!isAdmin && !isOwner) {
    return NextResponse.json({ error: 'Only the reservation owner or an admin can reassign it.' }, { status: 403 })
  }

  const patch: Record<string, any> = {}

  // buyer
  if ('buyer_id' in body) {
    const bid: string | null = body.buyer_id ?? null
    patch.buyer_id = bid
    if (bid) {
      const { data } = await sb.from('users').select('name, email').eq('id', bid).maybeSingle()
      patch.buyer_name = (data as any)?.name || (data as any)?.email || '(unknown)'
    } else {
      patch.buyer_name = 'unassigned'
    }
  }

  // Event / trade show — mutually exclusive at the DB level. Apply
  // the explicit fields and null the other side when the caller
  // sets one.
  let placedEventId: string | null | undefined
  let placedTradeShowId: string | null | undefined
  if ('event_id' in body) {
    placedEventId = body.event_id ?? null
    patch.event_id = placedEventId
    if (placedEventId) patch.trade_show_id = null
  }
  if ('trade_show_id' in body) {
    placedTradeShowId = body.trade_show_id ?? null
    patch.trade_show_id = placedTradeShowId
    if (placedTradeShowId) patch.event_id = null
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { error: upErr } = await sb.from('travel_reservations')
    .update(patch).eq('id', params.id)
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  // Log placement (only when an event or trade show was set).
  const setEventOrShow = ('event_id' in body && placedEventId)
    || ('trade_show_id' in body && placedTradeShowId)
  if (setEventOrShow) {
    const det = (existing.details || {}) as any
    const travelDate = (existing.check_in || existing.departure_at || null)
    await sb.from('travel_reservation_assignments').insert({
      reservation_id: params.id,
      assigned_by: me.id,
      event_id: placedEventId || null,
      trade_show_id: placedTradeShowId || null,
      parsed_vendor: existing.vendor || null,
      parsed_city: det?.city || null,
      parsed_state: det?.state || null,
      parsed_address: det?.address || null,
      travel_date: travelDate ? String(travelDate).slice(0, 10) : null,
    })
  }

  return NextResponse.json({ ok: true })
}
