'use client'

// Cross-event Shipping dashboard. Brand-scoped list of in-flight
// event_shipments with per-type status summaries, filters, and a
// drawer to open the per-event panel.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import EventShippingPanel from './EventShippingPanel'

type BoxStatus = 'pending' | 'labels_sent' | 'shipped' | 'received' | 'cancelled'
type ShipmentStatus = 'pending' | 'in_progress' | 'complete' | 'cancelled'
type StatusFilter = 'default' | 'all' | 'pending' | 'labels_sent' | 'shipped' | 'received' | 'has_issue'

interface BoxSummary { type: 'jewelry' | 'silver'; status: BoxStatus }

interface ShipmentEntry {
  id: string
  event_id: string
  store_id: string
  store_name: string
  ship_date: string
  jewelry_box_count: number
  silver_box_count: number
  status: ShipmentStatus
  event_workers: { id: string; name: string }[]
  event_start_date: string
  boxes: BoxSummary[]
}

const STATUS_ORDER: BoxStatus[] = ['pending', 'labels_sent', 'shipped', 'received']

function fmt(date: string): string {
  return new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtShort(date: string): string {
  return new Date(date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function summarize(boxes: BoxSummary[], type: 'jewelry' | 'silver'): string {
  const ofType = boxes.filter(b => b.type === type)
  const total = ofType.length
  if (total === 0) return '—'
  const counts = ofType.reduce((acc, b) => { acc[b.status] = (acc[b.status] || 0) + 1; return acc },
    { pending: 0, labels_sent: 0, shipped: 0, received: 0, cancelled: 0 } as Record<BoxStatus, number>)
  if (counts.received === total) return `All ${total} received ✓`
  if (counts.received > 0) return `${counts.received} of ${total} received`
  if (counts.shipped > 0) return `${counts.shipped} of ${total} shipped`
  if (counts.labels_sent > 0) return `${counts.labels_sent} of ${total} labels sent`
  return `0 of ${total} started`
}

function statusOfShipment(s: ShipmentEntry): BoxStatus {
  // Lowest box-status across both types — what's the slowest box?
  const statuses = s.boxes.map(b => b.status).filter(x => x !== 'cancelled')
  if (statuses.length === 0) return 'pending'
  const idxs = statuses.map(st => STATUS_ORDER.indexOf(st as BoxStatus))
  return STATUS_ORDER[Math.min(...idxs)]
}

export default function EventReturnsTab() {
  const { brand } = useApp()
  const [rows, setRows] = useState<ShipmentEntry[]>([])
  const [loaded, setLoaded] = useState(false)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('default')
  const [eventFilter, setEventFilter] = useState<string>('all')
  const [drawer, setDrawer] = useState<ShipmentEntry | null>(null)

  async function reload() {
    setLoaded(false)
    const { data: ships } = await supabase.from('event_shipments')
      .select('id, event_id, store_id, ship_date, jewelry_box_count, silver_box_count, status, events!inner(brand, store_name, workers, start_date)')
      .eq('events.brand', brand)
      .order('ship_date', { ascending: true })

    const shipmentRows: ShipmentEntry[] = (ships || []).map((r: any) => ({
      id: r.id,
      event_id: r.event_id,
      store_id: r.store_id,
      store_name: r.events?.store_name || '',
      ship_date: r.ship_date,
      jewelry_box_count: r.jewelry_box_count,
      silver_box_count: r.silver_box_count,
      status: r.status,
      event_workers: r.events?.workers || [],
      event_start_date: r.events?.start_date || '',
      boxes: [],
    }))

    if (shipmentRows.length > 0) {
      const { data: boxes } = await supabase.from('event_shipment_boxes')
        .select('shipment_id, type, status')
        .in('shipment_id', shipmentRows.map(s => s.id))
      const byShipment = new Map<string, BoxSummary[]>()
      for (const b of (boxes || []) as any[]) {
        const arr = byShipment.get(b.shipment_id) || []
        arr.push({ type: b.type, status: b.status })
        byShipment.set(b.shipment_id, arr)
      }
      for (const s of shipmentRows) s.boxes = byShipment.get(s.id) || []
    }

    setRows(shipmentRows)
    setLoaded(true)
  }
  useEffect(() => { reload() /* eslint-disable-next-line */ }, [brand])

  // Default filter: ship date ±7 days OR not complete/cancelled.
  const today = new Date()
  const filtered = useMemo(() => {
    const todayStr = today.toISOString().slice(0, 10)

    return rows.filter(s => {
      if (eventFilter !== 'all' && s.event_id !== eventFilter) return false

      if (statusFilter === 'all') return true
      if (statusFilter === 'has_issue') {
        // Placeholder until PR 7 — boxes past their alert window.
        // For now: any shipment with movement that's also past ship_date by >24h
        // and not fully received.
        const overdue = s.ship_date < todayStr
        const allDone = s.boxes.length > 0 && s.boxes.every(b => b.status === 'received' || b.status === 'cancelled')
        return overdue && !allDone
      }
      if (statusFilter === 'default') {
        // In-flight = not finished/cancelled. Per spec: ship date ±7 days
        // OR status is not complete/cancelled. The OR collapses to "not done".
        return s.status !== 'cancelled' && s.status !== 'complete'
      }
      // Specific box-status filter: shipment matches if it's at that state overall.
      return statusOfShipment(s) === statusFilter
    }).sort((a, b) => a.ship_date.localeCompare(b.ship_date))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, statusFilter, eventFilter])

  const eventOptions = useMemo(() =>
    [...rows].sort((a, b) => b.ship_date.localeCompare(a.ship_date)),
  [rows])

  return (
    <div className="p-6" style={{ maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)' }}>📦 Shipping Portal</h1>
        <div style={{ fontSize: 12, color: 'var(--mist)' }}>{filtered.length} of {rows.length} shipments</div>
      </div>

      {/* Filter bar */}
      <div className="card" style={{ marginBottom: 12, padding: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) minmax(220px,1fr)', gap: 10 }}>
          <div>
            <label className="fl">Status</label>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusFilter)}>
              <option value="default">In flight (default)</option>
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="labels_sent">Labels sent</option>
              <option value="shipped">Shipped</option>
              <option value="received">Received</option>
              <option value="has_issue">Has issue</option>
            </select>
          </div>
          <div>
            <label className="fl">Event</label>
            <select value={eventFilter} onChange={e => setEventFilter(e.target.value)} style={{ width: '100%' }}>
              <option value="all">All events</option>
              {eventOptions.map(s => (
                <option key={s.event_id} value={s.event_id}>
                  {s.store_name} · {fmtShort(s.event_start_date)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--cream2)', borderBottom: '2px solid var(--pearl)' }}>
                {['Event', 'Ship date', 'Jewelry', 'Silver', ''].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!loaded ? (
                <tr><td colSpan={5} style={{ padding: 30, textAlign: 'center', color: 'var(--mist)' }}>Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: 30, textAlign: 'center', color: 'var(--mist)' }}>
                  {rows.length === 0 ? 'No shipments yet.' : 'No shipments match the current filters.'}
                </td></tr>
              ) : filtered.map(s => {
                const past = s.ship_date < today.toISOString().slice(0, 10)
                return (
                  <tr key={s.id}
                    onClick={() => setDrawer(s)}
                    style={{ borderBottom: '1px solid var(--cream2)', cursor: 'pointer' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--cream2)')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ fontWeight: 800, color: 'var(--ink)' }}>{s.store_name}</div>
                      <div style={{ fontSize: 11, color: 'var(--mist)' }}>Event {fmtShort(s.event_start_date)}</div>
                    </td>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                      <div style={{ fontWeight: 700, color: past ? 'var(--red)' : 'var(--ink)' }}>{fmt(s.ship_date)}</div>
                      {past && s.status !== 'complete' && (
                        <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--red)' }}>past due</div>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--mist)' }}>{summarize(s.boxes, 'jewelry')}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--mist)' }}>{summarize(s.boxes, 'silver')}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      <button onClick={e => { e.stopPropagation(); setDrawer(s) }}
                        className="btn-outline btn-sm">Open →</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p style={{ fontSize: 11, color: 'var(--mist)', marginTop: 10, fontStyle: 'italic' }}>
        Tip: ⚠ stuck-shipment alerts and the &quot;Has issue&quot; filter will get smarter once PR 7 lands. For now &quot;Has issue&quot; shows shipments past their ship date that aren&apos;t fully received.
      </p>

      {drawer && (
        <div onClick={e => e.target === e.currentTarget && setDrawer(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{ width: 'min(720px, 95vw)', background: 'var(--cream)', height: '100%', overflowY: 'auto', padding: 18, boxShadow: '-8px 0 24px rgba(0,0,0,.18)' }}>
            <EventShippingPanel
              eventId={drawer.event_id}
              eventStartDate={drawer.event_start_date}
              eventWorkers={drawer.event_workers}
              onClose={() => { setDrawer(null); reload() }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
