// POST /api/notifications/:id/send-now
// Send a pending/held row immediately. Body may include
// { bypass_quiet_hours: true } — the UI sets this after confirming
// with the admin if the recipient is currently in their quiet hours.
//
// Same dispatch path as the cron worker, so the row's per-channel
// status / sent_at / retry_count fields are written normally — no
// duplicate row is created.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { dispatchOne } from '@/lib/notifications/dispatcher'

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
  const body = await req.json().catch(() => ({}))
  const bypassQH = !!body?.bypass_quiet_hours

  const sb = admin()

  // Atomically claim the row by flipping pending/held -> processing.
  // If another worker (or another Send Now click) already grabbed it,
  // the update returns 0 rows and we bail out.
  const { data: claimed, error: claimErr } = await sb
    .from('scheduled_notifications')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .in('status', ['pending', 'held'])
    .select('*')
    .maybeSingle()
  if (claimErr) return NextResponse.json({ error: claimErr.message }, { status: 500 })
  if (!claimed) {
    return NextResponse.json({ error: 'Row is not in a sendable state' }, { status: 409 })
  }

  // Manual Send Now gets a +2 burst over the rate limit and (optionally)
  // bypasses quiet hours per the admin's confirmation.
  const result = await dispatchOne(claimed as any, {
    bypassRateLimit: true,
    bypassQuietHours: bypassQH,
  })
  return NextResponse.json({ ok: true, result })
}
