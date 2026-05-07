// POST /api/broadcast/dismiss
//   Body: { broadcast_id }
// Records a per-user dismiss for the in-app banner.

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

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const broadcastId = String(body?.broadcast_id || '').trim()
  if (!broadcastId) return NextResponse.json({ error: 'Missing broadcast_id' }, { status: 400 })

  const sb = admin()
  await sb.from('broadcast_dismissals').upsert(
    { user_id: me.id, broadcast_id: broadcastId },
    { onConflict: 'user_id,broadcast_id' },
  )
  return NextResponse.json({ ok: true })
}
