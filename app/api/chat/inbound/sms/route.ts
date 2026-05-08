// POST /api/chat/inbound/sms
//
// Twilio inbound SMS webhook. Twilio POSTs application/x-www-form-
// urlencoded with at least: From, Body, MessageSid.
//
// Routing strategy (per Q9):
//   1. If Body contains "[ref: TOKEN]", use that token to find
//      the thread.
//   2. Otherwise fall back to "most recent active thread for
//      this phone number." Trims false matches if multiple
//      parallel threads exist.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { parseReplyTokenFromSmsBody } from '@/lib/chat/tokens'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

function normalizePhone(p: string): string {
  const digits = String(p || '').replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  return digits
}

export async function POST(req: Request) {
  // Twilio sends form-encoded data, not JSON.
  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })

  const fromRaw  = String(form.get('From') || '')
  const bodyText = String(form.get('Body') || '').trim()
  const sid      = String(form.get('MessageSid') || '')
  if (!bodyText) return NextResponse.json({ ok: true, skipped: 'empty' })

  const sb = admin()
  const fromDigits = normalizePhone(fromRaw)
  let thread: { id: string } | null = null

  // 1. Try the [ref: TOKEN] path.
  const token = parseReplyTokenFromSmsBody(bodyText)
  if (token) {
    const { data } = await sb.from('chat_threads').select('id').eq('reply_token', token).maybeSingle()
    if (data) thread = data
  }

  // 2. Fallback: most-recent active thread whose external phone
  //    matches the sender (after normalizing both sides).
  if (!thread && fromDigits) {
    const { data: candidates } = await sb
      .from('chat_threads')
      .select('id, external_phone, last_message_at')
      .eq('status', 'active')
      .order('last_message_at', { ascending: false })
      .limit(50)
    for (const c of (candidates || []) as any[]) {
      if (normalizePhone(c.external_phone || '') === fromDigits) {
        thread = { id: c.id }
        break
      }
    }
  }

  if (!thread) {
    // Log to a fallback table later if useful — for now just drop.
    return NextResponse.json({ ok: true, skipped: 'no_match' })
  }

  // Strip the "[ref: TOKEN]" wrapper from the visible body so the
  // thread shows the human content, not the routing metadata.
  const visibleBody = bodyText.replace(/\[\s*ref\s*:?\s*[0-9A-Z]{6,12}\s*\]/i, '').trim() || bodyText

  await sb.from('chat_messages').insert({
    thread_id: thread.id,
    sender_user_id: null,
    sender_display_name: fromRaw || 'External',
    body: visibleBody,
    channel_in: 'sms',
    channels_out: [],
    sms_sid: sid || null,
  })

  // Twilio expects an empty TwiML response on success.
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
}
