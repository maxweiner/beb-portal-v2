// POST /api/welcome-email/webhook/open
//
// Resend webhook handler for the `email.opened` event. Configure in the
// Resend dashboard → Webhooks → add an endpoint with the URL
//   https://beb-portal-v2.vercel.app/api/welcome-email/webhook/open
// and subscribe to the `email.opened` event.
//
// Resend's payload shape (as of 2025):
//   { type: 'email.opened', data: { email_id: '...', to: ['...'], created_at: '...' } }
//
// We match by email_id → welcome_email_log.resend_message_id and stamp
// opened_at. If the event fires for an unrelated email (any other system
// email), we just no-op since no row matches.

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
  let payload: any
  try { payload = await req.json() } catch { return NextResponse.json({ ok: true }) }

  const type = payload?.type
  const messageId = payload?.data?.email_id || payload?.data?.id
  if (type !== 'email.opened' || !messageId) {
    return NextResponse.json({ ok: true, ignored: true })
  }

  const sb = admin()
  await sb.from('welcome_email_log')
    .update({ opened_at: new Date().toISOString() })
    .eq('resend_message_id', messageId)
    .is('opened_at', null)

  return NextResponse.json({ ok: true })
}
