// GET /api/chat/unread-count
// Total messages not sent by me, on any thread I have access to,
// after my last_read_at on that thread. Drives the top-nav badge.

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

export async function GET(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ count: 0 })

  const sb = admin()

  // Threads the user can see: ones they created, are external on,
  // or have posted in. Mirrors the RLS policy.
  const { data: postedThreadIds } = await sb
    .from('chat_messages')
    .select('thread_id')
    .eq('sender_user_id', me.id)
  const postedSet = new Set((postedThreadIds || []).map((r: any) => r.thread_id))

  const { data: threads } = await sb
    .from('chat_threads')
    .select('id, last_message_at')
    .or(`created_by.eq.${me.id},external_user_id.eq.${me.id}`)
  const accessible = new Map<string, string>()
  for (const t of (threads || []) as any[]) accessible.set(t.id, t.last_message_at)
  // Add posted-in threads.
  if (postedSet.size > 0) {
    const { data: more } = await sb
      .from('chat_threads')
      .select('id, last_message_at')
      .in('id', [...postedSet])
    for (const t of (more || []) as any[]) accessible.set(t.id, t.last_message_at)
  }
  const ids = [...accessible.keys()]
  if (ids.length === 0) return NextResponse.json({ count: 0 })

  // Last-read map.
  const { data: reads } = await sb
    .from('chat_message_reads').select('thread_id, last_read_at')
    .eq('user_id', me.id).in('thread_id', ids)
  const readMap = new Map<string, string>((reads || []).map((r: any) => [r.thread_id, r.last_read_at]))

  // Count messages newer than last_read, not sent by me.
  const { data: msgs } = await sb
    .from('chat_messages')
    .select('thread_id, sender_user_id, created_at')
    .in('thread_id', ids)
  let count = 0
  for (const m of (msgs || []) as any[]) {
    if (m.sender_user_id === me.id) continue
    const lastRead = readMap.get(m.thread_id)
    if (lastRead && m.created_at <= lastRead) continue
    count++
  }

  return NextResponse.json({ count })
}
