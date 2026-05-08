// POST /api/chat/threads/[id]/read
// Marks the calling user as having read up through "now" on the thread.

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

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = admin()
  await sb.from('chat_message_reads').upsert(
    { user_id: me.id, thread_id: params.id, last_read_at: new Date().toISOString() },
    { onConflict: 'user_id,thread_id' },
  )
  return NextResponse.json({ ok: true })
}
