// POST /api/notifications/:id/cancel
// Admin (or superadmin) cancels a pending/held notification row.
// Already-sent rows are immutable — return 409.

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

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!params.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  const sb = admin()

  const { data: row } = await sb.from('scheduled_notifications')
    .select('id, status').eq('id', params.id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (row.status === 'sent' || row.status === 'cancelled' || row.status === 'failed') {
    return NextResponse.json({ error: `Cannot cancel — row is ${row.status}` }, { status: 409 })
  }

  const { error } = await sb.from('scheduled_notifications').update({
    status: 'cancelled',
    cancelled_reason: 'manual',
    updated_at: new Date().toISOString(),
  }).eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
