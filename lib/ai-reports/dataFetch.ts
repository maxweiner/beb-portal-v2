// Pulls the data scope an AI report runs against. v1 covers events
// (with day-level rollups, lead sources, top stores) for the report's
// brand within its time_window. Future scopes (expenses, customers,
// marketing campaigns, leads) can be added as opt-in flags without
// breaking the existing prompt contract — Claude just sees more
// numbered sections in the prompt.

import { createClient } from '@supabase/supabase-js'
import type { Brand, TimeWindow } from './types'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

interface DayRow {
  event_id: string
  day_number: number
  customers: number
  purchases: number
  dollars10: number
  dollars5: number
  dollars0: number
  src_vdp: number
  src_postcard: number
  src_social: number
  src_wordofmouth: number
  src_other: number
  src_repeat: number
  src_store: number
  src_text: number
  src_newspaper: number
}

interface EventRow {
  id: string
  store_id: string
  store_name: string
  start_date: string
  status: string | null
  cancelled_at: string | null
  workers: { id: string; name: string }[] | null
  days: DayRow[] | null
}

export interface ReportDataSnapshot {
  brand: Brand
  window: TimeWindow
  windowStartIso: string
  windowEndIso: string
  totals: {
    events: number
    eventsCompleted: number
    customers: number
    purchases: number
    dollarsSpent: number
    closeRatePct: number
  }
  topStoresBySpend: Array<{ name: string; events: number; purchases: number; dollars: number }>
  topBuyersByDays: Array<{ name: string; days: number }>
  leadSources: Array<{ label: string; count: number; pct: number }>
  perEvent: Array<{
    store: string
    start_date: string
    status: string
    customers: number
    purchases: number
    dollars: number
  }>
}

/** Resolve a TimeWindow string into ISO start/end dates (inclusive
 *  start, exclusive end — half-open). Both dates are in UTC. */
export function resolveWindow(window: TimeWindow, now: Date = new Date()): { start: string; end: string } {
  const end = new Date(now)
  const start = new Date(now)
  switch (window) {
    case 'last_7d':
      start.setUTCDate(start.getUTCDate() - 7)
      break
    case 'last_30d':
      start.setUTCDate(start.getUTCDate() - 30)
      break
    case 'last_90d':
      start.setUTCDate(start.getUTCDate() - 90)
      break
    case 'current_month':
      start.setUTCDate(1)
      start.setUTCHours(0, 0, 0, 0)
      break
  }
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  }
}

const NUM = (v: unknown): number => Number(v || 0)

export async function fetchReportData(brand: Brand, window: TimeWindow): Promise<ReportDataSnapshot> {
  const { start, end } = resolveWindow(window)

  const { data: events, error } = await sb
    .from('events')
    .select('id, store_id, store_name, start_date, status, cancelled_at, workers, days:event_days(*)')
    .eq('brand', brand)
    .gte('start_date', start)
    .lte('start_date', end)
    .order('start_date', { ascending: false })

  if (error) throw new Error(`fetchReportData events: ${error.message}`)

  const rows: EventRow[] = (events as EventRow[]) || []
  const live = rows.filter(e => e.status !== 'cancelled' && !e.cancelled_at)

  // Roll up totals
  let customers = 0, purchases = 0, dollars = 0
  const srcCounts: Record<string, number> = {
    'VDP / Large Postcard': 0, 'Store Postcard': 0, 'Social Media': 0,
    'Word of Mouth': 0, 'Repeat Customer': 0, 'Walk-in / Store': 0,
    'Text Message': 0, 'Newspaper': 0, 'Other': 0,
  }
  const perEvent: ReportDataSnapshot['perEvent'] = []
  for (const ev of live) {
    let evCust = 0, evPurch = 0, evDollars = 0
    for (const d of ev.days || []) {
      evCust    += NUM(d.customers)
      evPurch   += NUM(d.purchases)
      evDollars += NUM(d.dollars10) + NUM(d.dollars5) + NUM(d.dollars0)
      srcCounts['VDP / Large Postcard'] += NUM(d.src_vdp)
      srcCounts['Store Postcard']       += NUM(d.src_postcard)
      srcCounts['Social Media']         += NUM(d.src_social)
      srcCounts['Word of Mouth']        += NUM(d.src_wordofmouth)
      srcCounts['Repeat Customer']      += NUM(d.src_repeat)
      srcCounts['Walk-in / Store']      += NUM(d.src_store)
      srcCounts['Text Message']         += NUM(d.src_text)
      srcCounts['Newspaper']            += NUM(d.src_newspaper)
      srcCounts['Other']                += NUM(d.src_other)
    }
    customers += evCust
    purchases += evPurch
    dollars   += evDollars
    perEvent.push({
      store: ev.store_name || 'Unknown',
      start_date: ev.start_date,
      status: ev.status || 'scheduled',
      customers: evCust,
      purchases: evPurch,
      dollars: Math.round(evDollars),
    })
  }

  // Top stores by spend
  const byStore = new Map<string, { name: string; events: number; purchases: number; dollars: number }>()
  for (const e of perEvent) {
    const cur = byStore.get(e.store) || { name: e.store, events: 0, purchases: 0, dollars: 0 }
    cur.events += 1
    cur.purchases += e.purchases
    cur.dollars += e.dollars
    byStore.set(e.store, cur)
  }
  const topStoresBySpend = Array.from(byStore.values())
    .sort((a, b) => b.dollars - a.dollars)
    .slice(0, 10)

  // Top buyers by event-days worked
  const byBuyer = new Map<string, { name: string; days: number }>()
  for (const ev of live) {
    const dayCount = (ev.days || []).length
    for (const w of ev.workers || []) {
      const cur = byBuyer.get(w.id) || { name: w.name || 'Buyer', days: 0 }
      cur.days += dayCount
      byBuyer.set(w.id, cur)
    }
  }
  const topBuyersByDays = Array.from(byBuyer.values())
    .sort((a, b) => b.days - a.days)
    .slice(0, 10)

  // Lead sources percentage
  const srcTotal = Object.values(srcCounts).reduce((s, n) => s + n, 0)
  const leadSources = Object.entries(srcCounts)
    .filter(([, n]) => n > 0)
    .map(([label, count]) => ({
      label,
      count,
      pct: srcTotal > 0 ? Math.round((count / srcTotal) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count)

  return {
    brand,
    window,
    windowStartIso: start,
    windowEndIso: end,
    totals: {
      events: live.length,
      eventsCompleted: live.filter(e => e.start_date <= end).length,
      customers,
      purchases,
      dollarsSpent: Math.round(dollars),
      closeRatePct: customers > 0 ? Math.round((purchases / customers) * 100) : 0,
    },
    topStoresBySpend,
    topBuyersByDays,
    leadSources,
    perEvent,
  }
}

/** Format the data snapshot for inclusion in a Claude prompt. Kept
 *  as compact, structured text rather than raw JSON so the model
 *  spends fewer tokens parsing. */
export function formatSnapshotForPrompt(snap: ReportDataSnapshot): string {
  const money = (n: number) => '$' + n.toLocaleString('en-US')
  const lines: string[] = []
  lines.push(`Brand: ${snap.brand.toUpperCase()}`)
  lines.push(`Window: ${snap.windowStartIso} → ${snap.windowEndIso} (${snap.window})`)
  lines.push('')
  lines.push('=== TOTALS ===')
  lines.push(`Events in window: ${snap.totals.events} (${snap.totals.eventsCompleted} already-started)`)
  lines.push(`Customers seen:    ${snap.totals.customers}`)
  lines.push(`Purchases made:    ${snap.totals.purchases}`)
  lines.push(`Total spent:       ${money(snap.totals.dollarsSpent)}`)
  lines.push(`Close rate:        ${snap.totals.closeRatePct}%`)
  lines.push('')
  if (snap.topStoresBySpend.length > 0) {
    lines.push('=== TOP STORES BY SPEND ===')
    for (const s of snap.topStoresBySpend) {
      lines.push(`- ${s.name}: ${s.events} event(s), ${s.purchases} purchases, ${money(s.dollars)}`)
    }
    lines.push('')
  }
  if (snap.topBuyersByDays.length > 0) {
    lines.push('=== TOP BUYERS BY DAYS WORKED ===')
    for (const b of snap.topBuyersByDays) {
      lines.push(`- ${b.name}: ${b.days} day(s)`)
    }
    lines.push('')
  }
  if (snap.leadSources.length > 0) {
    lines.push('=== LEAD SOURCES ===')
    for (const s of snap.leadSources) {
      lines.push(`- ${s.label}: ${s.count} (${s.pct}%)`)
    }
    lines.push('')
  }
  if (snap.perEvent.length > 0) {
    lines.push('=== PER-EVENT DETAIL ===')
    for (const e of snap.perEvent.slice(0, 30)) {
      lines.push(`- ${e.start_date} @ ${e.store} (${e.status}): ${e.customers} customers, ${e.purchases} purchases, ${money(e.dollars)}`)
    }
    if (snap.perEvent.length > 30) {
      lines.push(`(...and ${snap.perEvent.length - 30} more events)`)
    }
  }
  return lines.join('\n')
}
