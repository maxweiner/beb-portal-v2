// GET  /api/chat/threads?record_kind=…&record_id=…
//   Lists threads attached to a record (most-recent first).
//
// POST /api/chat/threads
//   Body: { record_kind, record_id, external_user_id, subject? }
//   Creates a new thread. external_user_id must be an existing
//   public.users row — we snapshot their email + phone.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { generateReplyToken } from '@/lib/chat/tokens'

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
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const recordKind = url.searchParams.get('record_kind') || ''
  const recordId   = url.searchParams.get('record_id')   || ''
  if (!recordKind || !recordId) return NextResponse.json({ error: 'record_kind + record_id required' }, { status: 400 })

  const sb = admin()
  const { data, error } = await sb
    .from('chat_threads')
    .select(`
      id, record_kind, record_id, external_user_id, external_email, external_phone,
      reply_token, subject, status, created_at, last_message_at,
      external:users!chat_threads_external_user_id_fkey(name, phone)
    `)
    .eq('record_kind', recordKind)
    .eq('record_id', recordId)
    .order('last_message_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Per-thread unread count for the caller.
  const ids = (data || []).map((t: any) => t.id)
  const unread = new Map<string, number>()
  if (ids.length > 0) {
    const { data: reads } = await sb
      .from('chat_message_reads').select('thread_id, last_read_at')
      .eq('user_id', me.id).in('thread_id', ids)
    const readMap = new Map<string, string>((reads || []).map((r: any) => [r.thread_id, r.last_read_at]))
    const { data: msgs } = await sb
      .from('chat_messages').select('thread_id, created_at, sender_user_id')
      .in('thread_id', ids)
    for (const m of (msgs || []) as any[]) {
      // Only count messages NOT sent by me, after my last_read_at.
      if (m.sender_user_id === me.id) continue
      const lastRead = readMap.get(m.thread_id)
      if (lastRead && m.created_at <= lastRead) continue
      unread.set(m.thread_id, (unread.get(m.thread_id) || 0) + 1)
    }
  }

  const threads = (data || []).map((t: any) => ({
    ...t,
    external_name: t.external?.name || null,
    unread: unread.get(t.id) || 0,
  }))
  return NextResponse.json({ threads })
}

export async function POST(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const recordKind = String(body?.record_kind || '').trim()
  const recordId   = String(body?.record_id   || '').trim()
  const externalUserId = String(body?.external_user_id || '').trim()
  const subject    = String(body?.subject || '').trim() || null

  if (!recordKind || !recordId || !externalUserId) {
    return NextResponse.json({ error: 'record_kind + record_id + external_user_id required' }, { status: 400 })
  }

  const sb = admin()
  // Snapshot external recipient's email + phone.
  const { data: u } = await sb.from('users').select('id, email, phone, name').eq('id', externalUserId).maybeSingle()
  if (!u) return NextResponse.json({ error: 'External user not found' }, { status: 404 })

  // Generate a unique token (retry on collision — practically never needed).
  let token = generateReplyToken()
  for (let i = 0; i < 5; i++) {
    const { data: clash } = await sb.from('chat_threads').select('id').eq('reply_token', token).maybeSingle()
    if (!clash) break
    token = generateReplyToken()
  }

  const { data: thread, error: insErr } = await sb
    .from('chat_threads')
    .insert({
      record_kind: recordKind,
      record_id: recordId,
      external_user_id: u.id,
      external_email: u.email,
      external_phone: u.phone,
      subject,
      reply_token: token,
      created_by: me.id,
    })
    .select('id, reply_token')
    .single()
  if (insErr || !thread) return NextResponse.json({ error: insErr?.message || 'create failed' }, { status: 500 })

  return NextResponse.json({ thread_id: thread.id, reply_token: thread.reply_token })
}
