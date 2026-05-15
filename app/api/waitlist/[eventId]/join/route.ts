// POST /api/waitlist/[eventId]/join
//
// Public endpoint — no auth. Accepts walk-in waitlist signups
// from the public form at /waitlist/<eventId>.
//
// Validates input, computes today's 7pm cutoff in the store's
// local timezone, rejects past-7pm submissions, inserts the row
// using the service-role client (bypasses RLS), and sends a
// confirmation SMS when notify_pref='sms'.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendSMS, formatPhone } from '@/lib/sms'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

/**
 * Today's 7pm in the given timezone, returned as a UTC ISO
 * timestamp. Falls back to America/New_York for unknown tz.
 *
 * If we're already past 7pm today, returns null (signup closed).
 */
function cutoffOrNull(tz: string): string | null {
  try {
    const now = new Date()
    // Get today's date in the store's timezone (YYYY-MM-DD).
    const ymd = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now)  // en-CA gives ISO-style YYYY-MM-DD

    // The 7pm-local instant. We construct ISO + tz-naive 19:00:00,
    // then determine the offset for that instant in `tz` and convert.
    const localStr = `${ymd}T19:00:00`
    const naive = new Date(localStr + 'Z')   // pretend UTC, get naive ms

    // Compute the tz offset for that instant: format the same instant
    // in tz, parse back to numbers, take the diff.
    const offsetMin = tzOffsetMinutes(naive, tz)
    const cutoffUtc = new Date(naive.getTime() - offsetMin * 60_000)

    if (now >= cutoffUtc) return null
    return cutoffUtc.toISOString()
  } catch {
    // Unknown tz — fall back to a fixed UTC time that's roughly 7pm Eastern.
    const d = new Date()
    d.setUTCHours(23, 0, 0, 0)
    if (new Date() >= d) return null
    return d.toISOString()
  }
}

/** Minutes that `tz` is offset from UTC at the given UTC instant. */
function tzOffsetMinutes(utcInstant: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
  const parts = fmt.formatToParts(utcInstant)
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0)
  const tzMs = Date.UTC(
    get('year'), get('month') - 1, get('day'),
    get('hour') === 24 ? 0 : get('hour'),
    get('minute'), get('second'),
  )
  return Math.round((tzMs - utcInstant.getTime()) / 60_000)
}

export async function POST(req: Request, { params }: { params: { eventId: string } }) {
  const body = await req.json().catch(() => ({}))
  const name = String(body.name || '').trim()
  const phone = String(body.phone || '').trim()
  const item_count = Number(body.item_count)
  const how_heard = body.how_heard ? String(body.how_heard).trim() : null
  const rawPref = String(body.notify_pref || 'wait')
  const notify_pref: 'sms' | 'wait' = rawPref === 'sms' ? 'sms' : 'wait'
  // Twilio-compliant explicit opt-in. The signup checkbox is
  // optional + unchecked-by-default; we only fire SMS when this
  // is TRUE *AND* the older notify_pref selector landed on 'sms'.
  // Coerce to boolean — never trust a stray truthy value.
  const sms_opted_in = body.sms_opted_in === true

  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!phone) return NextResponse.json({ error: 'Phone is required' }, { status: 400 })
  if (!Number.isFinite(item_count) || item_count < 0) {
    return NextResponse.json({ error: 'Item count must be a non-negative number' }, { status: 400 })
  }

  const sb = admin()

  const { data: ev } = await sb
    .from('events')
    .select('id, store_id, status')
    .eq('id', params.eventId)
    .maybeSingle()
  if (!ev) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
  if (ev.status === 'cancelled') {
    return NextResponse.json({ error: 'This event has been cancelled' }, { status: 409 })
  }

  const { data: store } = await sb
    .from('stores')
    .select('name, timezone')
    .eq('id', ev.store_id)
    .maybeSingle()
  const tz = store?.timezone || 'America/New_York'
  const expires_at = cutoffOrNull(tz)
  if (!expires_at) {
    return NextResponse.json(
      { error: "Today's waitlist is closed (resets at 7pm). Please return tomorrow." },
      { status: 409 },
    )
  }

  const { data: row, error } = await sb.from('event_waitlist').insert({
    event_id: ev.id,
    name, phone, item_count, how_heard,
    notify_pref,
    sms_opted_in,
    expires_at,
    // added_by_user_id stays NULL — public self-signup.
  }).select('id, name').maybeSingle()

  if (error || !row) {
    return NextResponse.json({ error: error?.message || 'Insert failed' }, { status: 500 })
  }

  // SMS confirmation (best-effort — failure to send doesn't roll
  // back the waitlist signup since the customer is already on the
  // list and we can text them when they're up).
  //
  // Twilio compliance: require BOTH the legacy notify_pref='sms'
  // selector AND the new explicit sms_opted_in checkbox. The
  // checkbox is the audit-trail piece reviewers verify in the
  // toll-free verification flow.
  if (notify_pref === 'sms' && sms_opted_in) {
    try {
      const formatted = formatPhone(phone)
      await sendSMS(formatted, `You're on the waitlist for ${store?.name || 'this event'}. We'll text you when you're up.`)
      await sb.from('event_waitlist').update({ notified_at: new Date().toISOString() }).eq('id', row.id)
    } catch {
      // swallow — staff can call them in person if SMS fails
    }
  }

  return NextResponse.json({ ok: true, id: row.id })
}
