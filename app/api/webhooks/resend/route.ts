// POST /api/webhooks/resend
//
// Receives delivery events from Resend and updates the matching
// communication_sends row's delivery_status. Auth via a shared
// secret in the URL query string — Resend's webhook config
// allows setting a custom URL, so the operator pastes
// /api/webhooks/resend?secret=<token> as the destination.
//
// Stored at settings.value where key='resend_webhook_secret'.
//
// Events we honor:
//   email.delivered          → status='delivered'
//   email.bounced            → status='bounced'
//   email.failed             → status='failed'
//   email.delivery_delayed   → ignored (still in transit)
//   email.complained         → ignored (spam complaint, separate concern)
//   email.opened / email.clicked → ignored per spec (no engagement
//   tracking in v1)
//
// Resend webhook payload reference:
//   { type: "email.delivered", created_at: "...", data: { email_id, ... } }
// We match on data.email_id ↔ communication_sends.resend_message_id.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { CommunicationDeliveryStatus } from '@/types'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

function eventToStatus(eventType: string): CommunicationDeliveryStatus | null {
  switch (eventType) {
    case 'email.delivered': return 'delivered'
    case 'email.bounced':   return 'bounced'
    case 'email.failed':    return 'failed'
    default: return null
  }
}

export async function POST(req: Request) {
  const sb = admin()

  // Shared-secret gate (optional — defaults to allow if unset).
  const { data: secretRow } = await sb
    .from('settings').select('value').eq('key', 'resend_webhook_secret').maybeSingle()
  const expected = ((secretRow as any)?.value as string | undefined)?.replace(/^"|"$/g, '')
  if (expected) {
    const url = new URL(req.url)
    const got = url.searchParams.get('secret') || ''
    if (got !== expected) {
      return NextResponse.json({ error: 'Bad webhook secret' }, { status: 401 })
    }
  }

  let payload: any
  try { payload = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const eventType = String(payload?.type || '')
  const newStatus = eventToStatus(eventType)
  if (!newStatus) {
    // Acknowledge (200) so Resend doesn't retry — but no-op.
    return NextResponse.json({ ok: true, ignored: eventType })
  }

  const messageId = String(payload?.data?.email_id || '')
  if (!messageId) {
    return NextResponse.json({ error: 'Missing data.email_id' }, { status: 400 })
  }

  // Don't downgrade an already-final status. Only progress
  // sent → delivered / bounced / failed.
  const { data: row } = await sb
    .from('communication_sends')
    .select('id, delivery_status')
    .eq('resend_message_id', messageId)
    .maybeSingle()

  if (!row) {
    // Webhook arrived for a message we don't own — ack so Resend
    // doesn't retry but log it for diagnostic.
    console.warn(`[resend-webhook] no communication_sends row for message_id ${messageId}`)
    return NextResponse.json({ ok: true, matched: false })
  }

  // Allow delivered → bounced (rare but possible for delayed
  // bounces) but don't unset bounced/failed back to delivered.
  if ((row.delivery_status === 'bounced' || row.delivery_status === 'failed') && newStatus === 'delivered') {
    return NextResponse.json({ ok: true, ignored: 'already_final' })
  }

  await sb.from('communication_sends').update({
    delivery_status: newStatus,
    delivery_status_updated_at: new Date().toISOString(),
  }).eq('id', row.id)

  return NextResponse.json({ ok: true, matched: true, status: newStatus })
}
