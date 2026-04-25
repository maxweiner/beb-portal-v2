// POST /api/notifications/:id/retry
// Re-queue a failed row for one more attempt. Resets retry_count to
// 0 so the dispatcher gives it the full backoff schedule again, and
// resets per-channel statuses so all originally-requested channels
// are tried.

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

  const { data: row } = await sb.from('scheduled_notifications')
    .select('id, status, channels').eq('id', params.id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (row.status !== 'failed') {
    return NextResponse.json({ error: `Cannot retry — row is ${row.status}` }, { status: 409 })
  }

  const channels = (row.channels || []) as string[]
  const { error } = await sb.from('scheduled_notifications').update({
    status: 'pending',
    retry_count: 0,
    error_message: null,
    scheduled_for: new Date().toISOString(),
    email_status: channels.includes('email') ? 'pending' : null,
    sms_status: channels.includes('sms') ? 'pending' : null,
    updated_at: new Date().toISOString(),
  }).eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
