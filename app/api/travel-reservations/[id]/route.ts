// PATCH /api/travel-reservations/:id
// Body: any subset of editable reservation fields. Currently used to set
// `amount` from the UI when the parser couldn't extract a cost. Easy to
// extend with more fields later.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { blockIfImpersonating } from '@/lib/impersonation/server'

export const dynamic = 'force-dynamic'

const ALLOWED_FIELDS = new Set(['amount', 'vendor', 'confirmation_number', 'check_in', 'check_out'])

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!params.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const update: Record<string, any> = {}
  for (const k of Object.keys(body || {})) {
    if (ALLOWED_FIELDS.has(k)) update[k] = body[k]
  }
  if ('amount' in update) {
    const n = Number(update.amount)
    update.amount = Number.isFinite(n) && n >= 0 ? n : 0
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No editable fields supplied' }, { status: 400 })
  }

  const sb = admin()
  const { error } = await sb.from('travel_reservations').update(update).eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
