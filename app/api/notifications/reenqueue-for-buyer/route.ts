// POST /api/notifications/reenqueue-for-buyer
//
// Called from any UI that edits a buyer's name / phone / email.
// Walks every in-flight (pending or held) scheduled_notifications row
// for the buyer and re-enqueues each one with a fresh delay timer +
// refreshed merge snapshot. This implements the spec's
// "edits reset the timer with latest info" rule.
//
// Body: { buyer_id: string, reason?: string }
// Response: { reenqueued: number, skipped: number, errors: string[] }

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cancelAndReenqueue } from '@/lib/notifications/enqueue'
import type { TriggerType } from '@/lib/notifications/triggers'

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
  const buyer_id = body?.buyer_id
  const reason = body?.reason || 'buyer_edited'
  if (!buyer_id) return NextResponse.json({ error: 'Missing buyer_id' }, { status: 400 })

  const sb = admin()

  // Find every in-flight row for this buyer.
  const { data: rows, error } = await sb.from('scheduled_notifications')
    .select('id, brand, trigger_type, related_event_id')
    .eq('recipient_buyer_id', buyer_id)
    .in('status', ['pending', 'held'])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let reenqueued = 0
  let skipped = 0
  const errors: string[] = []

  for (const row of rows || []) {
    if (!row.related_event_id || !row.brand || !row.trigger_type) {
      skipped++
      continue
    }
    try {
      const result = await cancelAndReenqueue({
        brand: row.brand as 'beb' | 'liberty',
        trigger_type: row.trigger_type as TriggerType,
        buyer_id,
        event_id: row.related_event_id,
        reason,
      })
      if (result.enqueued) reenqueued++
      else if (!result.ok) errors.push(`${row.id}: ${result.reason}`)
      else skipped++
    } catch (e: any) {
      errors.push(`${row.id}: ${e?.message || 'unknown'}`)
    }
  }

  return NextResponse.json({ reenqueued, skipped, errors: errors.length ? errors : undefined })
}
