// PUT /api/travel-reservations/:id/assign
// Body: { buyer_id: string | null }
//
// Reassigns a travel reservation to a buyer (or clears the assignment).
// Used when the inbound email parser couldn't auto-match the sender to a
// user and an admin needs to attribute the reservation manually.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
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

  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const buyer_id: string | null = body?.buyer_id ?? null

  const sb = admin()
  let buyer_name: string | null = null
  if (buyer_id) {
    const { data } = await sb.from('users').select('name, email').eq('id', buyer_id).maybeSingle()
    buyer_name = (data as any)?.name || (data as any)?.email || null
  }

  const { error } = await sb.from('travel_reservations').update({
    buyer_id,
    buyer_name: buyer_name || (buyer_id ? '(unknown)' : 'unassigned'),
  }).eq('id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
