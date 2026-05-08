// POST /api/chat/inbound/email
//
// Postmark inbound webhook. Configure the Postmark inbound stream
// to POST here. Payload shape (relevant fields):
//   {
//     FromFull:   { Email, Name },
//     ToFull:     [ { Email, Name } ],
//     Subject,
//     TextBody,
//     StrippedTextReply,    ← just the new reply, quotes removed
//     MessageID
//   }
//
// We pull the reply token from the To-address plus-tag (e.g.
// "replies+ABC123@replies.bebllp.com"), look up the matching
// thread, and append a chat_messages row with channel_in='email'.
// The body uses StrippedTextReply when available so the thread
// shows just the new content without quoted history.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { parseReplyTokenFromAddress } from '@/lib/chat/tokens'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function POST(req: Request) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  // Find the token. Try every recipient address (To, Cc) — Postmark
  // ToFull is an array.
  const toAddrs: string[] = []
  for (const t of (body?.ToFull || []) as any[]) if (t?.Email) toAddrs.push(String(t.Email))
  for (const t of (body?.CcFull || []) as any[]) if (t?.Email) toAddrs.push(String(t.Email))
  let token: string | null = null
  for (const addr of toAddrs) {
    const t = parseReplyTokenFromAddress(addr)
    if (t) { token = t; break }
  }
  if (!token) {
    return NextResponse.json({ ok: true, skipped: 'no_reply_token_in_to_address' })
  }

  const sb = admin()
  const { data: thread } = await sb
    .from('chat_threads')
    .select('id, external_user_id, external_email')
    .eq('reply_token', token)
    .maybeSingle()
  if (!thread) {
    return NextResponse.json({ ok: true, skipped: 'unknown_token', token })
  }

  const fromEmail = String(body?.FromFull?.Email || body?.From || '').trim().toLowerCase()
  const fromName  = String(body?.FromFull?.Name  || fromEmail || 'External')
  const replyBody: string = (body?.StrippedTextReply || body?.TextBody || '').toString().trim()
  if (!replyBody) {
    return NextResponse.json({ ok: true, skipped: 'empty_reply' })
  }

  await sb.from('chat_messages').insert({
    thread_id: thread.id,
    sender_user_id: null,
    sender_display_name: fromName || fromEmail || 'External',
    body: replyBody,
    channel_in: 'email',
    channels_out: [],
    email_message_id: body?.MessageID || null,
  })

  return NextResponse.json({ ok: true, thread_id: thread.id })
}
