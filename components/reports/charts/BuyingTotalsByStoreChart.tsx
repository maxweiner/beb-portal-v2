'use client'

// Visual report: cumulative buying spend per store across every
// non-cancelled event for the brand. Horizontal bar chart, sorted
// largest → smallest, with date-range and brand filters.
//
// Data source: events.brand-scoped + event_days.dollars10/dollars5
// (same shape eventSpend() reads). All client-side aggregation —
// no new endpoint needed.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useApp } from '@/lib/context'
import { eventSpend } from '@/lib/eventSpend'
import { fmtMoney } from '@/lib/format'

type DateRange = 'all' | 'this-year' | 'last-year' | 'last-12mo' | 'last-24mo'

interface StoreTotal {
  store_id: string
  name: string
  city: string | null
  state: string | null
  total: number
  eventCount: number
}

const RANGE_LABELS: Record<DateRange, string> = {
  'all':       'All time',
  'this-year': 'This year',
  'last-year': 'Last year',
  'last-12mo': 'Last 12 months',
  'last-24mo': 'Last 24 months',
}

function rangeBounds(range: DateRange): { start?: string; end?: string } {
  const today = new Date()
  const ymd = (d: Date) => d.toISOString().slice(0, 10)
  if (range === 'all') return {}
  if (range === 'this-year') {
    return { start: `${today.getFullYear()}-01-01`, end: `${today.getFullYear()}-12-31` }
  }
  if (range === 'last-year') {
    const y = today.getFullYear() - 1
    return { start: `${y}-01-01`, end: `${y}-12-31` }
  }
  if (range === 'last-12mo') {
    const back = new Date(today); back.setFullYear(back.getFullYear() - 1)
    return { start: ymd(back), end: ymd(today) }
  }
  // last-24mo
  const back = new Date(today); back.setFullYear(back.getFullYear() - 2)
  return { start: ymd(back), end: ymd(today) }
}

export default function BuyingTotalsByStoreChart() {
  const { brand, stores } = useApp()
  const [range, setRange] = useState<DateRange>('all')
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<StoreTotal[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      const { start, end } = rangeBounds(range)
      let q = supabase
        .from('events')
        .select('id, store_id, status, start_date, days:event_days(dollars10, dollars5)')
        .eq('brand', brand)
        .neq('status', 'cancelled')
      if (start) q = q.gte('start_date', start)
      if (end)   q = q.lte('start_date', end)
      const { data: events } = await q
      if (cancelled) return

      // Aggregate by store_id.
      const byStore = new Map<string, StoreTotal>()
      for (const ev of (events || []) as any[]) {
        const sid = ev.store_id as string
        if (!sid) continue
        const spend = eventSpend({ days: ev.days || [] })
        if (spend <= 0) continue
        const existing = byStore.get(sid)
        if (existing) {
          existing.total += spend
          existing.eventCount += 1
        } else {
          const store = stores.find(s => s.id === sid)
          byStore.set(sid, {
            store_id: sid,
            name: store?.name || '(unknown store)',
            city: store?.city || null,
            state: store?.state || null,
            total: spend,
            eventCount: 1,
          })
        }
      }
      const sorted = [...byStore.values()].sort((a, b) => b.total - a.total)
      setRows(sorted)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [brand, range, stores])

  const max = rows.length > 0 ? rows[0].total : 0
  const grand = useMemo(() => rows.reduce((s, r) => s + r.total, 0), [rows])

  return (
    <div className="card" style={{ background: '#fff', padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <h2 style={{ fontSize: 17, fontWeight: 900, margin: 0 }}>Buying Totals by Store</h2>
          <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 2 }}>
            Cumulative spend per store across every non-cancelled buying event.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 11, color: 'var(--mist)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '.04em' }}>Range</label>
          <select value={range} onChange={e => setRange(e.target.value as DateRange)} style={{ width: 'auto', fontSize: 13 }}>
            {(Object.keys(RANGE_LABELS) as DateRange[]).map(k => (
              <option key={k} value={k}>{RANGE_LABELS[k]}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Summary line */}
      {!loading && rows.length > 0 && (
        <div style={{ fontSize: 13, color: 'var(--ash)', marginBottom: 10 }}>
          <b>{rows.length}</b> store{rows.length === 1 ? '' : 's'} · grand total <b>{fmtMoney(grand, { cents: false })}</b>
        </div>
      )}

      {/* Chart */}
      {loading ? (
        <div style={{ color: 'var(--mist)', fontSize: 13, padding: 20 }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ color: 'var(--mist)', fontSize: 13, padding: 20, textAlign: 'center', fontStyle: 'italic' }}>
          No spend data for this range.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 600, overflowY: 'auto' }}>
          {rows.map(r => {
            const pct = max > 0 ? Math.max(0.5, (r.total / max) * 100) : 0
            const cityStr = [r.city, r.state].filter(Boolean).join(', ')
            return (
              <div key={r.store_id} style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 220px) 1fr 130px', gap: 10, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--cream2)' }}>
                {/* Label */}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.name}>
                    {r.name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--mist)' }}>
                    {cityStr || ''}{cityStr && ' · '}{r.eventCount} event{r.eventCount === 1 ? '' : 's'}
                  </div>
                </div>
                {/* Bar */}
                <div style={{ background: 'var(--cream2)', borderRadius: 4, height: 22, position: 'relative', overflow: 'hidden' }}>
                  <div style={{
                    width: `${pct}%`, height: '100%',
                    background: '#1E3A8A', // buying-blue from the calendar palette
                    borderRadius: 4,
                    transition: 'width .3s ease',
                  }} />
                </div>
                {/* Amount */}
                <div style={{ fontSize: 13, fontWeight: 700, textAlign: 'right', color: 'var(--ink)', whiteSpace: 'nowrap' }}>
                  {fmtMoney(r.total, { cents: false })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
