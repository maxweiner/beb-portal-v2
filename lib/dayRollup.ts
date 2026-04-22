import { supabase } from '@/lib/supabase'

/**
 * Aggregate all buyer_entries for a given event+day and upsert the
 * totals into event_days. Downstream readers (Dashboard, Events pill
 * fallback, Reports) get a single source of truth without polling two
 * tables. Called from DayEntry BuyerEntryForm.persist and
 * MobileDayEntry.persist after every successful buyer-side write.
 *
 * If no buyer_entries rows exist we return early — legacy event_days
 * rows (entered via Combined mode) stay intact.
 */
const SRC_COLS = [
  'src_vdp', 'src_postcard', 'src_social', 'src_wordofmouth',
  'src_repeat', 'src_store', 'src_text', 'src_newspaper', 'src_other',
] as const

export async function rollupEventDay(eventId: string, dayNumber: number) {
  if (!eventId || !dayNumber) return
  const { data: rows, error: readErr } = await supabase
    .from('buyer_entries')
    .select(`customers_seen, purchases_made, dollars_at_10pct, dollars_at_5pct, ${SRC_COLS.join(', ')}`)
    .eq('event_id', eventId)
    .eq('day_number', dayNumber)
  if (readErr) { console.warn('[rollup] read failed', readErr.message); return }
  if (!rows || rows.length === 0) return

  const sumNum = (key: string) =>
    rows.reduce((s: number, r: any) => s + (Number(r[key]) || 0), 0)

  const payload: any = {
    event_id: eventId,
    day_number: dayNumber,
    day: dayNumber,
    customers: sumNum('customers_seen'),
    purchases: sumNum('purchases_made'),
    dollars10:  sumNum('dollars_at_10pct'),
    dollars5:   sumNum('dollars_at_5pct'),
    entered_by: null,
    entered_by_name: 'system:rollup',
    entered_at: new Date().toISOString(),
  }
  for (const col of SRC_COLS) payload[col] = sumNum(col)

  const { data: existing } = await supabase
    .from('event_days')
    .select('id')
    .eq('event_id', eventId)
    .eq('day_number', dayNumber)
    .maybeSingle()

  if (existing?.id) {
    const { error } = await supabase.from('event_days').update(payload).eq('id', existing.id)
    if (error) console.warn('[rollup] update failed', error.message)
  } else {
    const { error } = await supabase.from('event_days').insert(payload)
    if (error) console.warn('[rollup] insert failed', error.message)
  }
}
