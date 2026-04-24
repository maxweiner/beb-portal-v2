// Cron-triggered. Sends 24-hour and 2-hour reminders for upcoming confirmed
// appointments. Auth via ?secret=<CRON_SECRET> matching the existing
// daily-report pattern. Designed for a cadence around every 30 min.
//
// Idempotency: an appointment that already has *any* row in notification_log
// for the same hours-bucket (24h or 2h) is skipped, regardless of whether the
// prior attempt was 'sent' or 'failed'. We don't retry failures here — the
// notification_log keeps an audit trail to debug.
//
// TODO: appointment_date + appointment_time are interpreted in the same
// timezone as the cron host (Vercel = UTC). For non-UTC stores this will
// reminder early/late. Fix when stores get a `timezone` column.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendReminder } from '@/lib/appointments/notifications'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

const WINDOW_MIN = 20 // ± minutes around the 24h / 2h target

function apptTimestamp(date: string, time: string): number {
  const t = time.length >= 5 ? time.slice(0, 5) : time
  return new Date(`${date}T${t}:00Z`).getTime()
}

async function run(req: Request) {
  const url = new URL(req.url)
  const secret = url.searchParams.get('secret')
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = admin()
  const now = Date.now()

  // Pull confirmed appointments in the next ~30 hours so both windows are covered.
  const today = new Date(now).toISOString().slice(0, 10)
  const horizonDate = new Date(now + 30 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const { data: appts, error: apptErr } = await sb
    .from('appointments')
    .select('id, cancel_token, customer_name, customer_phone, customer_email, appointment_date, appointment_time, store_id')
    .eq('status', 'confirmed')
    .gte('appointment_date', today)
    .lte('appointment_date', horizonDate)
  if (apptErr) return NextResponse.json({ error: apptErr.message }, { status: 500 })

  if (!appts || appts.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, sent: 0 })
  }

  // Existing reminder log entries to dedupe by appointment_id × hours bucket.
  const { data: alreadySent } = await sb
    .from('notification_log')
    .select('appointment_id, type')
    .in('appointment_id', appts.map(a => a.id))
    .in('type', ['sms_reminder_24h', 'email_reminder_24h', 'sms_reminder_2h', 'email_reminder_2h'])

  const sentMap = new Map<string, Set<string>>()
  for (const r of alreadySent ?? []) {
    if (!sentMap.has(r.appointment_id)) sentMap.set(r.appointment_id, new Set())
    sentMap.get(r.appointment_id)!.add(r.type)
  }

  // Resolve store info for the unique store_ids.
  const storeIds = [...new Set(appts.map(a => a.store_id))]
  const { data: stores } = await sb
    .from('stores')
    .select('id, name, slug, owner_phone, owner_email')
    .in('id', storeIds)
  const storeMap = new Map((stores ?? []).map(s => [s.id, s]))

  const windowMs = WINDOW_MIN * 60 * 1000
  let sent = 0
  let skipped = 0

  for (const a of appts) {
    const store = storeMap.get(a.store_id)
    if (!store) continue
    const ts = apptTimestamp(a.appointment_date, a.appointment_time)
    const sentTypes = sentMap.get(a.id) ?? new Set()
    const has24 = sentTypes.has('sms_reminder_24h') || sentTypes.has('email_reminder_24h')
    const has2 = sentTypes.has('sms_reminder_2h') || sentTypes.has('email_reminder_2h')

    const delta24 = ts - now - 24 * 60 * 60 * 1000
    const delta2 = ts - now - 2 * 60 * 60 * 1000

    if (Math.abs(delta24) <= windowMs && !has24) {
      await sendReminder({
        appt: {
          id: a.id, cancel_token: a.cancel_token,
          customer_name: a.customer_name,
          customer_phone: a.customer_phone,
          customer_email: a.customer_email,
          appointment_date: a.appointment_date,
          appointment_time: a.appointment_time,
        },
        store: {
          name: store.name, slug: store.slug,
          owner_phone: store.owner_phone, owner_email: store.owner_email,
        },
        hours: 24,
      })
      sent++
    } else if (Math.abs(delta2) <= windowMs && !has2) {
      await sendReminder({
        appt: {
          id: a.id, cancel_token: a.cancel_token,
          customer_name: a.customer_name,
          customer_phone: a.customer_phone,
          customer_email: a.customer_email,
          appointment_date: a.appointment_date,
          appointment_time: a.appointment_time,
        },
        store: {
          name: store.name, slug: store.slug,
          owner_phone: store.owner_phone, owner_email: store.owner_email,
        },
        hours: 2,
      })
      sent++
    } else {
      skipped++
    }
  }

  return NextResponse.json({ ok: true, scanned: appts.length, sent, skipped })
}

export async function POST(req: Request) { return run(req) }
export async function GET(req: Request) { return run(req) }
