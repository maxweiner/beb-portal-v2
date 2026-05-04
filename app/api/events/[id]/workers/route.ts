// PUT /api/events/:id/workers
//
// Single chokepoint for mutating event.workers. Diffs the incoming
// workers list against the current one, persists the change, and
// fires the buyer_added_to_event trigger for newly-added buyers and
// cancels any in-flight notification for removed buyers.
//
// Body: { workers: { id: string; name: string }[] }
// Response: { workers, added, removed, notifications: { enqueued, cancelled } }

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { enqueueNotification, cancelPendingNotification } from '@/lib/notifications/enqueue'
import { blockIfImpersonating } from '@/lib/impersonation/server'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

interface Worker { id: string; name: string }

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const eventId = params.id
  if (!eventId) return NextResponse.json({ error: 'Missing event id' }, { status: 400 })

  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const incoming: Worker[] = Array.isArray(body?.workers) ? body.workers : []
  if (!incoming.every(w => w && typeof w.id === 'string' && typeof w.name === 'string')) {
    return NextResponse.json({ error: 'workers must be { id, name }[]' }, { status: 400 })
  }

  const sb = admin()

  const { data: event, error: getErr } = await sb.from('events')
    .select('id, brand, workers, status, store_name, start_date')
    .eq('id', eventId)
    .maybeSingle()
  if (getErr) return NextResponse.json({ error: getErr.message }, { status: 500 })
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

  const current: Worker[] = Array.isArray(event.workers) ? event.workers : []
  const currentIds = new Set(current.map(w => w.id))
  const incomingIds = new Set(incoming.map(w => w.id))

  // Diff — but only for "real" buyers (skip the deleted_${uid} sentinel rows
  // AdminPanel writes when a user is hard-deleted).
  const added = incoming.filter(w => !currentIds.has(w.id) && !w.id.startsWith('deleted_'))
  const removed = current.filter(w => !incomingIds.has(w.id) && !w.id.startsWith('deleted_'))

  const { error: updErr } = await sb.from('events')
    .update({ workers: incoming })
    .eq('id', eventId)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  const brand = (event.brand === 'liberty' ? 'liberty' : 'beb') as 'beb' | 'liberty'

  // Fire-and-track notification side-effects. We don't want one bad
  // recipient to fail the whole save — log and return counts.
  let enqueued = 0
  let cancelled = 0
  const errors: string[] = []

  // For Reserved (Save-the-Date) events, send a lightweight one-shot
  // email per Q4=C: buyer is informed to hold the date, but we skip
  // the operational pipeline (calendar invite, briefing inclusion,
  // SMS) until promoted to Booked. Standard notifications resume on
  // promotion via the natural buyer_added_to_event flow.
  const isReserved = event.status === 'reserved'

  await Promise.all(added.map(async w => {
    try {
      if (isReserved) {
        const lightOk = await sendSaveTheDateEmail(sb, w.id, event.store_name as string, event.start_date as string)
        if (lightOk) enqueued++
        else errors.push(`save-the-date email ${w.name}: skipped (no email or Resend not configured)`)
      } else {
        const r = await enqueueNotification({
          brand,
          trigger_type: 'buyer_added_to_event',
          buyer_id: w.id,
          event_id: eventId,
        })
        if (r.enqueued) enqueued++
        else if (!r.ok) errors.push(`enqueue ${w.name}: ${r.reason}`)
      }
    } catch (e: any) {
      errors.push(`enqueue ${w.name}: ${e?.message || 'unknown'}`)
    }
  }))

  await Promise.all(removed.map(async w => {
    try {
      const r = await cancelPendingNotification({
        buyer_id: w.id,
        trigger_type: 'buyer_added_to_event',
        event_id: eventId,
        reason: 'buyer_removed',
      })
      cancelled += r.cancelled
    } catch (e: any) {
      errors.push(`cancel ${w.name}: ${e?.message || 'unknown'}`)
    }
  }))

  return NextResponse.json({
    workers: incoming,
    added: added.map(w => w.id),
    removed: removed.map(w => w.id),
    notifications: { enqueued, cancelled },
    errors: errors.length ? errors : undefined,
  })
}

/** Lightweight one-shot Save-the-Date email via Resend. Returns
 *  true if sent, false if skipped (no buyer email, Resend not
 *  configured). Errors bubble to the caller's catch. */
async function sendSaveTheDateEmail(
  sb: ReturnType<typeof admin>, buyerId: string, storeName: string, startDate: string,
): Promise<boolean> {
  const { data: u } = await sb.from('users').select('name, email').eq('id', buyerId).maybeSingle()
  const email = (u as any)?.email
  const name = (u as any)?.name || 'there'
  if (!email) return false

  const { data: keyRow } = await sb.from('settings').select('value').eq('key', 'resend_api_key').single()
  const key = (keyRow?.value || '').toString().replace(/"/g, '')
  if (!key) return false

  const dt = new Date(startDate + 'T12:00:00')
  const dateStr = dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const portal = process.env.NEXT_PUBLIC_APP_URL || 'https://portal.bebllp.com'

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'BEB Events <events@updates.bebllp.com>',
      to: email,
      subject: `📌 Save the Date — ${storeName} on ${dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
      html: `<p>Hi ${name?.split(' ')[0] || 'there'},</p>
        <p>You've been added to a <strong>tentative</strong> event at <strong>${storeName}</strong> on <strong>${dateStr}</strong>.</p>
        <p>This is a Save the Date — the event isn't fully confirmed yet, but please hold the day. You'll get the normal calendar invite + reminders once it's promoted to a Booked event.</p>
        <p><a href="${portal}/?nav=events">Open the portal</a></p>`,
    }),
  })
  return res.ok
}
