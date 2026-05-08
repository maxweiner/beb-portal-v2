// GET  /api/chat/threads/[id]/messages
//   Returns the full message list (chronological) for a thread.
//
// POST /api/chat/threads/[id]/messages
//   Body: { body, also_email?, also_sms? }
//   Posts an internal-user message into the thread and optionally
//   dispatches it via email and/or SMS to the external recipient.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { dispatchChatMessage } from '@/lib/chat/sender'
import { blockIfImpersonating } from '@/lib/impersonation/server'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = admin()
  const { data: thread, error: tErr } = await sb
    .from('chat_threads')
    .select('id, record_kind, record_id, external_user_id, external_email, external_phone, reply_token, subject, status, created_by, last_message_at')
    .eq('id', params.id)
    .maybeSingle()
  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })
  if (!thread) return NextResponse.json({ error: 'Thread not found' }, { status: 404 })

  const { data: messages, error: mErr } = await sb
    .from('chat_messages')
    .select('id, sender_user_id, sender_display_name, body, channel_in, channels_out, delivery_status, created_at')
    .eq('thread_id', thread.id)
    .order('created_at', { ascending: true })
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 })

  return NextResponse.json({ thread, messages: messages || [] })
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const text = String(body?.body || '').trim()
  if (!text) return NextResponse.json({ error: 'Empty message' }, { status: 400 })
  const alsoEmail = body?.also_email === true
  const alsoSms   = body?.also_sms === true

  const sb = admin()
  const { data: thread, error: tErr } = await sb
    .from('chat_threads')
    .select('id, reply_token, external_email, external_phone, subject')
    .eq('id', params.id)
    .maybeSingle()
  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })
  if (!thread) return NextResponse.json({ error: 'Thread not found' }, { status: 404 })

  // Dispatch FIRST so we know which channels actually fired before
  // we record the message. This way the row reflects reality.
  const dispatch = await dispatchChatMessage({
    sb,
    thread,
    senderName: me.name || 'Internal',
    body: text,
    alsoEmail,
    alsoSms,
  })

  const { data: inserted, error: insErr } = await sb
    .from('chat_messages')
    .insert({
      thread_id: thread.id,
      sender_user_id: me.id,
      sender_display_name: me.name || me.email || 'Internal',
      body: text,
      channel_in: 'web',
      channels_out: dispatch.channelsOut,
      email_message_id: dispatch.emailMessageId,
      sms_sid: dispatch.smsSid,
      delivery_status: dispatch.deliveryStatus,
    })
    .select('id, created_at')
    .single()
  if (insErr || !inserted) return NextResponse.json({ error: insErr?.message || 'insert failed' }, { status: 500 })

  // Persist any channel-skipped notes as system messages so they
  // appear inline in the thread.
  for (const note of dispatch.systemNotes) {
    await sb.from('chat_messages').insert({
      thread_id: thread.id,
      sender_user_id: null,
      sender_display_name: 'System',
      body: note,
      channel_in: 'system',
    })
  }

  // Auto-mark this user as having read up through the new message.
  await sb.from('chat_message_reads').upsert(
    { user_id: me.id, thread_id: thread.id, last_read_at: inserted.created_at },
    { onConflict: 'user_id,thread_id' },
  )

  return NextResponse.json({ ok: true, message_id: inserted.id, channels_out: dispatch.channelsOut })
}
