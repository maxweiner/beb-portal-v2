// POST /api/chat/inbound/telnyx
//
// Telnyx inbound Messaging webhook. Telnyx POSTs JSON shaped like:
//   { data: { event_type: "message.received", payload: { id, text,
//     from: { phone_number }, to: [...], direction, ... } } }
//
// Telnyx also POSTs outbound delivery events ("message.sent",
// "message.finalized") to the same URL — we ack those and skip.
//
// Routing mirrors the Twilio handler in ./sms/route.ts:
//   1. If body contains "[ref: TOKEN]", use that token.
//   2. Otherwise fall back to most-recent active thread for this phone.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { parseReplyTokenFromSmsBody } from '@/lib/chat/tokens'
import {
  verifyTelnyxSignature,
  normalizeTelnyxPhone,
  loadTelnyxConfig,
} from '@/lib/sms/telnyx'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function POST(req: Request) {
  const rawBody = await req.text()
  const sb = admin()
  const cfg = await loadTelnyxConfig(sb)
  const publicKey = cfg.publicKey || process.env.TELNYX_PUBLIC_KEY

  // Signature verification is mandatory in prod. In dev, allow an
  // unset key so you can curl-test locally.
  if (publicKey) {
    const verdict = verifyTelnyxSignature({
      rawBody,
      timestamp: req.headers.get('telnyx-timestamp'),
      signature: req.headers.get('telnyx-signature-ed25519'),
      publicKeyB64: publicKey,
    })
    if (!verdict.ok) {
      return NextResponse.json({ error: 'invalid_signature', reason: verdict.reason }, { status: 401 })
    }
  } else if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'telnyx_public_key_missing' }, { status: 500 })
  }

  let event: any
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const eventType: string = event?.data?.event_type || ''
  if (eventType !== 'message.received') {
    // Outbound DLR (message.sent / message.finalized) etc. — ack & skip.
    return NextResponse.json({ ok: true, skipped: eventType || 'unknown_event' })
  }

  const payload = event?.data?.payload || {}
  const fromRaw: string = payload?.from?.phone_number || ''
  const bodyText: string = String(payload?.text || '').trim()
  const tnxId: string = payload?.id || ''
  if (!bodyText) return NextResponse.json({ ok: true, skipped: 'empty' })

  const fromDigits = normalizeTelnyxPhone(fromRaw)
  let thread: { id: string } | null = null

  // 1. Try the [ref: TOKEN] path.
  const token = parseReplyTokenFromSmsBody(bodyText)
  if (token) {
    const { data } = await sb.from('chat_threads').select('id').eq('reply_token', token).maybeSingle()
    if (data) thread = data
  }

  // 2. Fallback: most-recent active thread whose external phone matches.
  if (!thread && fromDigits) {
    const { data: candidates } = await sb
      .from('chat_threads')
      .select('id, external_phone, last_message_at')
      .eq('status', 'active')
      .order('last_message_at', { ascending: false })
      .limit(50)
    for (const c of (candidates || []) as any[]) {
      if (normalizeTelnyxPhone(c.external_phone || '') === fromDigits) {
        thread = { id: c.id }
        break
      }
    }
  }

  if (!thread) {
    return NextResponse.json({ ok: true, skipped: 'no_match' })
  }

  const visibleBody =
    bodyText.replace(/\[\s*ref\s*:?\s*[0-9A-Z]{6,12}\s*\]/i, '').trim() || bodyText

  await sb.from('chat_messages').insert({
    thread_id: thread.id,
    sender_user_id: null,
    sender_display_name: fromRaw || 'External',
    body: visibleBody,
    channel_in: 'sms',
    channels_out: [],
    sms_sid: tnxId || null,
  })

  // Telnyx accepts any 2xx; JSON ack is fine (unlike Twilio's TwiML requirement).
  return NextResponse.json({ ok: true })
}
