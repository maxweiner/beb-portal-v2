// PUT /api/data-research/total-sent
// Body: { qr_code_id: string, event_id: string, total_sent: number }
//
// Upserts the (qr_code_id, event_id) row in qr_campaign_sends.

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

export async function PUT(req: Request) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { qr_code_id, event_id, total_sent } = body || {}
  if (!qr_code_id || !event_id) return NextResponse.json({ error: 'qr_code_id and event_id required' }, { status: 400 })
  const value = Number(total_sent)
  if (!Number.isFinite(value) || value < 0) {
    return NextResponse.json({ error: 'total_sent must be a non-negative number' }, { status: 400 })
  }

  const sb = admin()
  const { error } = await sb.from('qr_campaign_sends').upsert({
    qr_code_id,
    event_id,
    total_sent: Math.floor(value),
    updated_at: new Date().toISOString(),
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
