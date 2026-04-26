// POST /api/gcal-sync/:id/retry
// Resets a 'failed' queue row back to 'pending' for the worker to pick up.

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

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  if (!params.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const sb = admin()
  const { error } = await sb.from('gcal_sync_queue').update({
    status: 'pending',
    attempts: 0,
    last_error: null,
    scheduled_for: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', params.id).eq('status', 'failed')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
