// POST /api/broadcast/webhook
//
// Resend webhook receiver. Resend posts events for delivery, opens,
// clicks, bounces, etc. We map them to broadcast_recipients rows by
// `resend_id` (set when we sent the email).
//
// To activate, register this URL in the Resend dashboard as the
// webhook endpoint and choose the event types: email.delivered,
// email.opened, email.clicked, email.bounced, email.complained.

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

export async function POST(req: Request) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  // Resend payload shape: { type: 'email.opened', data: { email_id, ... } }
  const type = String(body?.type || '')
  const emailId = body?.data?.email_id || body?.data?.id
  if (!type || !emailId) return NextResponse.json({ ok: true, skipped: 'no event' })

  const sb = admin()
  const updates: Record<string, any> = {}
  const nowIso = new Date().toISOString()
  switch (type) {
    case 'email.delivered':  updates.delivered_at = nowIso; break
    case 'email.opened':     updates.opened_at    = nowIso; break
    case 'email.clicked':    updates.clicked_at   = nowIso; break
    case 'email.bounced':    updates.status = 'bounced';    updates.error_text = (body?.data?.bounce?.message || 'bounced').toString().slice(0, 300); break
    case 'email.complained': updates.status = 'complained'; break
    default: return NextResponse.json({ ok: true, skipped: type })
  }

  await sb.from('broadcast_recipients').update(updates).eq('resend_id', emailId)
  return NextResponse.json({ ok: true })
}
