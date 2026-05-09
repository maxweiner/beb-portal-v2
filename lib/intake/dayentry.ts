/**
 * Submit-to-Day-Entry roll-up (Phase 4).
 *
 * Aggregates a buyer's intakes for a given event + day and writes the totals
 * into the existing `events.days` array. Pre-fills only — the buyer can
 * still hand-edit Day Entry afterwards.
 */

import { supabase } from '@/lib/supabase'
import type { Event, EventDay } from '@/types'

export interface IntakeRollupRow {
  id: string
  customer_id: string | null
  intake_kind: 'check_in' | 'purchase' | 'check_in_then_purchase'
  purchase_amount: number | null
  commission_bucket: 'rate_10' | 'rate_5' | 'rate_0' | 'store' | null
}

export interface RollupTotals {
  customers: number
  purchases: number
  dollars10: number
  dollars5: number
  dollars0: number
  storePurchases: number
}

export function aggregateIntakes(rows: IntakeRollupRow[]): RollupTotals {
  // Customer count = unique persons. We dedup on customer_id when present;
  // rows without a customer_id (dedup couldn't run) each count as their own.
  const peopleSet = new Set<string>()
  let unmatchedPeople = 0
  for (const r of rows) {
    if (r.customer_id) peopleSet.add(r.customer_id)
    else unmatchedPeople++
  }

  let purchases = 0
  let dollars10 = 0
  let dollars5 = 0
  let dollars0 = 0
  let storePurchases = 0

  for (const r of rows) {
    const isPurchase = r.intake_kind === 'purchase' || r.intake_kind === 'check_in_then_purchase'
    if (!isPurchase) continue
    purchases++
    const amt = r.purchase_amount || 0
    switch (r.commission_bucket) {
      case 'rate_10': dollars10 += amt; break
      case 'rate_5':  dollars5  += amt; break
      case 'rate_0':  dollars0  += amt; break
      case 'store':   storePurchases += amt; break
    }
  }

  return {
    customers: peopleSet.size + unmatchedPeople,
    purchases,
    dollars10,
    dollars5,
    dollars0,
    storePurchases,
  }
}

/**
 * Compute the day_number (1, 2, or 3) for `today` relative to the event's
 * start_date. Returns null if today is outside the event's 3-day window.
 */
export function dayNumberFor(event: { start_date?: string | null }, todayIso: string): number | null {
  if (!event.start_date) return null
  const start = new Date(event.start_date + 'T12:00:00').getTime()
  const today = new Date(todayIso + 'T12:00:00').getTime()
  const diffDays = Math.round((today - start) / 86_400_000)
  if (diffDays < 0 || diffDays > 2) return null
  return diffDays + 1
}

/**
 * Submit a worksheet's totals to the matching event_days row.
 * - If no row exists for that day_number, inserts one.
 * - Otherwise updates customers + dollars10/5/0 + store_purchases.
 *   Does NOT touch source-of-business fields (vdp/postcard/etc) — those
 *   come from manual Day Entry only.
 * Marks every included intake with submitted_to_day_entry_at = now().
 */
export async function submitWorksheetToDayEntry({
  eventId, dayNumber, totals, intakeIds,
}: {
  eventId: string
  dayNumber: number
  totals: RollupTotals
  intakeIds: string[]
}): Promise<{ ok: true } | { ok: false; error: string }> {
  // Locate / upsert the day row.
  const { data: existing, error: selErr } = await supabase
    .from('event_days')
    .select('id')
    .eq('event_id', eventId)
    .eq('day_number', dayNumber)
    .maybeSingle()
  if (selErr) return { ok: false, error: `Lookup failed: ${selErr.message}` }

  const dayPayload = {
    event_id: eventId,
    day_number: dayNumber,
    customers: totals.customers,
    purchases: totals.purchases,
    dollars10: totals.dollars10,
    dollars5: totals.dollars5,
    dollars0: totals.dollars0,
  }

  if (existing?.id) {
    const { error: updErr } = await supabase
      .from('event_days')
      .update(dayPayload)
      .eq('id', existing.id)
    if (updErr) return { ok: false, error: `Update failed: ${updErr.message}` }
  } else {
    const { error: insErr } = await supabase
      .from('event_days')
      .insert(dayPayload)
    if (insErr) return { ok: false, error: `Insert failed: ${insErr.message}` }
  }

  // Mark intakes as submitted.
  if (intakeIds.length > 0) {
    const { error: markErr } = await supabase
      .from('customer_intakes')
      .update({ submitted_to_day_entry_at: new Date().toISOString() })
      .in('id', intakeIds)
    if (markErr) {
      console.warn('[dayentry] mark intakes failed', markErr)
    }
  }

  return { ok: true }
}
