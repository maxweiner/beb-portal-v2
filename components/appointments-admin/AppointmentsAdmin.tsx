'use client'

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type { Store, Event } from '@/types'
import { formatPhoneDisplay } from '@/lib/phone'
import AddAppointmentModal from './AddAppointmentModal'

// ---------- types ----------

type Source = 'beb-portal' | 'gcal'

interface AppointmentRow {
  source: Source
  // Time
  startUtc: string         // ISO; for sorting / display only (timezone-naive)
  appointment_date: string // YYYY-MM-DD (store-local)
  appointment_time: string // HH:MM   (store-local)
  // Identity / store
  store_id: string
  store_name: string
  // Customer
  customer_name: string
  customer_phone: string
  customer_email: string
  items_bringing: string[]
  how_heard: string[]
  // BEB Portal-only fields
  id?: string              // appointments.id
  cancel_token?: string
  status?: string
  is_walkin?: boolean
  appointment_employee_id?: string | null
  appointment_employee_name?: string | null
  notes?: string | null
  // iCal raw fallback
  raw_title?: string
  raw_description?: string
}

type DateFilter = 'today' | 'this-week' | 'next-week' | 'all-upcoming' | 'past'

// On weekends (Sat/Sun) default the page to next week — by then this
// week's appointments are mostly past. Mon-Fri stay on this week. Day
// of week is anchored to America/New_York so the default doesn't drift
// by user timezone.
function defaultDateFilter(): DateFilter {
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
  }).format(new Date())
  return day === 'Sat' || day === 'Sun' ? 'next-week' : 'this-week'
}

// ---------- date helpers (all local-time, no tz library) ----------

function todayIso(): string {
  const d = new Date()
  return ymd(d)
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function startOfWeek(d: Date): Date {
  const out = new Date(d)
  const dow = out.getDay()
  out.setDate(out.getDate() - ((dow + 6) % 7)) // Monday-start week
  out.setHours(0, 0, 0, 0)
  return out
}
function addDays(d: Date, n: number): Date {
  const out = new Date(d); out.setDate(out.getDate() + n); return out
}
function dateInRange(dateStr: string, range: DateFilter): boolean {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const target = new Date(dateStr + 'T12:00:00')
  switch (range) {
    case 'today': return ymd(target) === ymd(today)
    case 'this-week': {
      const wkStart = startOfWeek(today)
      const wkEnd = addDays(wkStart, 6)
      return target >= wkStart && target <= wkEnd
    }
    case 'next-week': {
      const wkStart = addDays(startOfWeek(today), 7)
      const wkEnd = addDays(wkStart, 6)
      return target >= wkStart && target <= wkEnd
    }
    case 'all-upcoming': return target >= today
    case 'past': return target < today
  }
}
function fmtDateLong(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtTime(t: string): string {
  const tt = t.length >= 5 ? t.slice(0, 5) : t
  const [h, m] = tt.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

// ---------- data fetching ----------

async function fetchPortalAppts(stores: Store[]): Promise<AppointmentRow[]> {
  // Don't pre-filter by store window — pull everything portal-side and let
  // the UI's "When" filter narrow it down. Stores months in the future
  // (e.g., Dec event scheduled in April) still need to surface.
  const { data, error } = await supabase
    .from('appointments')
    .select(`
      id, store_id, appointment_date, appointment_time,
      customer_name, customer_phone, customer_email,
      items_bringing, how_heard, status, cancel_token,
      is_walkin, appointment_employee_id, notes,
      appointment_employee:store_employees(name),
      store:stores(name)
    `)
    .order('appointment_date', { ascending: true })
    .order('appointment_time', { ascending: true })
  if (error) { console.error('admin fetch portal appts failed', error); return [] }
  return (data || []).map((a: any) => {
    const time = (a.appointment_time as string).length >= 5 ? a.appointment_time.slice(0, 5) : a.appointment_time
    return {
      source: 'beb-portal' as const,
      startUtc: `${a.appointment_date}T${time}:00Z`,
      appointment_date: a.appointment_date,
      appointment_time: time,
      store_id: a.store_id,
      store_name: a.store?.name || stores.find(s => s.id === a.store_id)?.name || '(unknown store)',
      customer_name: a.customer_name || '',
      customer_phone: a.customer_phone || '',
      customer_email: a.customer_email || '',
      items_bringing: Array.isArray(a.items_bringing) ? a.items_bringing : [],
      how_heard: Array.isArray(a.how_heard) ? a.how_heard : [],
      id: a.id,
      cancel_token: a.cancel_token,
      status: a.status,
      is_walkin: !!a.is_walkin,
      appointment_employee_id: a.appointment_employee_id,
      appointment_employee_name: a.appointment_employee?.name ?? null,
      notes: a.notes,
    }
  })
}

async function fetchGcalAppts(stores: Store[]): Promise<AppointmentRow[]> {
  // Reuse the existing /api/appointments/by-store endpoint for portal data,
  // and fetch iCal separately per-store via the existing /api/fetch-ical proxy
  // so this view automatically picks up any feed_url the Calendar tab uses.
  const out: AppointmentRow[] = []
  await Promise.all(stores.filter(s => s.calendar_feed_url).map(async (store) => {
    try {
      const res = await fetch(`/api/fetch-ical?url=${encodeURIComponent(store.calendar_feed_url!)}`)
      if (!res.ok) return
      const text = await res.text()
      const { parseIcal, parseApptDetail } = await import('@/lib/calendar')
      const offsetMs = (store.calendar_offset_hours || 0) * 60 * 60 * 1000
      for (const a of parseIcal(text)) {
        const adj = offsetMs === 0 ? a : { ...a, start: new Date(a.start.getTime() + offsetMs), end: new Date(a.end.getTime() + offsetMs) }
        const detail = parseApptDetail(adj)
        const date = `${adj.start.getUTCFullYear()}-${String(adj.start.getUTCMonth() + 1).padStart(2, '0')}-${String(adj.start.getUTCDate()).padStart(2, '0')}`
        const time = `${String(adj.start.getUTCHours()).padStart(2, '0')}:${String(adj.start.getUTCMinutes()).padStart(2, '0')}`
        out.push({
          source: 'gcal',
          startUtc: adj.start.toISOString(),
          appointment_date: date,
          appointment_time: time,
          store_id: store.id,
          store_name: store.name,
          customer_name: detail.name || adj.title,
          customer_phone: detail.phone,
          customer_email: detail.email,
          items_bringing: detail.items ? [detail.items] : [],
          how_heard: detail.howHeard ? [detail.howHeard] : [],
          raw_title: adj.title,
          raw_description: adj.description,
        })
      }
    } catch (e) {
      console.error('iCal fetch failed for store', store.id, e)
    }
  }))
  return out
}

// ---------- main component ----------

export default function AppointmentsAdmin() {
  const { stores, events, user } = useApp()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'

  const [appts, setAppts] = useState<AppointmentRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)
  const [showAddModal, setShowAddModal] = useState(false)

  const [dateFilter, setDateFilter] = useState<DateFilter>(defaultDateFilter)
  const [sourceFilter, setSourceFilter] = useState<Source | 'all'>('all')
  const [storeFilter, setStoreFilter] = useState<string>('all')
  const [search, setSearch] = useState('')

  // Only fetch iCal (HTTP, expensive) for stores with an event in the next ~2 months.
  // BEB Portal appointments are a single Supabase query covering everything, so they
  // ignore this window — far-future bookings (e.g., December event seeded in April)
  // still need to surface.
  const icalStores = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const twoMonths = 60 * 24 * 60 * 60 * 1000
    const ids = new Set(events.filter(ev => {
      if (!ev.start_date) return false
      const start = new Date(ev.start_date + 'T12:00:00')
      const end = new Date(start); end.setDate(end.getDate() + 2)
      return Math.abs(end.getTime() - today.getTime()) < twoMonths
    }).map(ev => ev.store_id))
    return stores.filter(s => ids.has(s.id))
  }, [stores, events])

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    Promise.all([fetchPortalAppts(stores), fetchGcalAppts(icalStores)]).then(([portal, gcal]) => {
      if (cancelled) return
      setAppts([...portal, ...gcal])
      setLoaded(true)
    })
    return () => { cancelled = true }
  }, [stores, icalStores, refreshTick])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return appts.filter(a => {
      // Cancelled appointments are hidden from the schedule (display-only;
      // the rows still exist in the DB and are accessible to reports).
      if (a.status === 'cancelled') return false
      if (storeFilter !== 'all' && a.store_id !== storeFilter) return false
      if (sourceFilter !== 'all' && a.source !== sourceFilter) return false
      if (!dateInRange(a.appointment_date, dateFilter)) return false
      if (q) {
        const hay = `${a.customer_name} ${a.customer_phone} ${a.customer_email}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    }).sort((a, b) => (a.startUtc < b.startUtc ? -1 : 1))
  }, [appts, dateFilter, sourceFilter, storeFilter, search])

  const byStore = useMemo(() => {
    const m = new Map<string, AppointmentRow[]>()
    for (const a of filtered) {
      if (!m.has(a.store_id)) m.set(a.store_id, [])
      m.get(a.store_id)!.push(a)
    }
    const arr = [...m.entries()]
    arr.sort(([, a], [, b]) => a[0].store_name.localeCompare(b[0].store_name))
    return arr
  }, [filtered])

  async function handleCancel(row: AppointmentRow) {
    if (row.source !== 'beb-portal' || !row.cancel_token) return
    if (!confirm(`Cancel ${row.customer_name}'s appointment on ${fmtDateLong(row.appointment_date)} at ${fmtTime(row.appointment_time)}?`)) return
    const res = await fetch(`/api/appointments/${row.cancel_token}`, { method: 'DELETE' })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      alert('Could not cancel: ' + (j.error || res.status))
      return
    }
    setRefreshTick(t => t + 1)
  }

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)' }}>Appointments</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-primary btn-sm" onClick={() => setShowAddModal(true)}>+ Add Appointment</button>
          <button className="btn-outline btn-sm" onClick={() => setRefreshTick(t => t + 1)}>↻ Refresh</button>
        </div>
      </div>

      {showAddModal && (
        <AddAppointmentModal
          stores={stores}
          events={events}
          onClose={() => setShowAddModal(false)}
          onCreated={() => setRefreshTick(t => t + 1)}
        />
      )}

      {/* Filter bar */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8,
        padding: 12, marginBottom: 14, background: 'white',
        border: '1px solid var(--pearl)', borderRadius: 'var(--r)',
      }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="fl">When</label>
          <select value={dateFilter} onChange={e => setDateFilter(e.target.value as DateFilter)} style={{ width: '100%' }}>
            <option value="today">Today</option>
            <option value="this-week">This week</option>
            <option value="next-week">Next week</option>
            <option value="all-upcoming">All upcoming</option>
            <option value="past">Past</option>
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="fl">Source</label>
          <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value as any)} style={{ width: '100%' }}>
            <option value="all">All sources</option>
            <option value="beb-portal">BEB Portal</option>
            <option value="gcal">Google Calendar</option>
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="fl">Store</label>
          <select value={storeFilter} onChange={e => setStoreFilter(e.target.value)} style={{ width: '100%' }}>
            <option value="all">All stores</option>
            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="fl">Search</label>
          <input
            type="search"
            placeholder="Name, phone, or email"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {!loaded && (
        <p style={{ color: 'var(--mist)', fontSize: 13 }}>Loading appointments…</p>
      )}

      {loaded && (
        <div style={{
          fontSize: 12, color: 'var(--mist)', marginBottom: 10,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6,
        }}>
          <span>
            Showing <strong>{filtered.length}</strong> of {appts.length} total
            {filtered.length < appts.length && dateFilter !== 'all-upcoming' && (
              <> · <button
                onClick={() => setDateFilter('all-upcoming')}
                style={{ background: 'none', border: 'none', color: 'var(--green)', cursor: 'pointer', fontSize: 12, padding: 0, textDecoration: 'underline' }}
              >Show all upcoming</button></>
            )}
          </span>
        </div>
      )}

      {loaded && filtered.length === 0 && (
        <div style={{
          padding: 30, textAlign: 'center', background: 'white',
          border: '1px solid var(--pearl)', borderRadius: 'var(--r)',
          color: 'var(--mist)',
        }}>
          No appointments match these filters.
          {appts.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <button onClick={() => { setDateFilter('all-upcoming'); setSearch(''); setStoreFilter('all'); setSourceFilter('all') }}
                className="btn-outline btn-sm">
                Reset filters
              </button>
            </div>
          )}
        </div>
      )}

      {byStore.map(([storeId, rows], index) => (
        <StoreGroup
          // Re-mount when the date filter changes so the "expand last" rule
          // re-applies fresh against the new shape of the list. Within a
          // single filter, the user's manual toggle still sticks.
          key={`${storeId}-${dateFilter}`}
          rows={rows}
          isAdmin={isAdmin}
          onCancel={handleCancel}
          initiallyCollapsed={byStore.length > 1 && index < byStore.length - 1}
        />
      ))}
    </div>
  )
}

// ---------- store group section ----------

function StoreGroup({ rows, isAdmin, onCancel, initiallyCollapsed }: {
  rows: AppointmentRow[]
  isAdmin: boolean
  onCancel: (row: AppointmentRow) => void
  initiallyCollapsed: boolean
}) {
  const [collapsed, setCollapsed] = useState(initiallyCollapsed)
  const storeName = rows[0]?.store_name || ''

  // Group by date within the store
  const byDate = useMemo(() => {
    const m = new Map<string, AppointmentRow[]>()
    for (const r of rows) {
      if (!m.has(r.appointment_date)) m.set(r.appointment_date, [])
      m.get(r.appointment_date)!.push(r)
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [rows])

  return (
    <div style={{
      marginBottom: 14, background: 'white',
      border: '1px solid var(--pearl)', borderRadius: 'var(--r)', overflow: 'hidden',
    }}>
      <button
        onClick={() => setCollapsed(c => !c)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '12px 16px', border: 'none',
          background: 'var(--cream2)', cursor: 'pointer',
          fontWeight: 800, color: 'var(--ink)', fontSize: 15, textAlign: 'left',
        }}
      >
        <span>{storeName}</span>
        <span style={{ fontSize: 12, color: 'var(--mist)', fontWeight: 600 }}>
          · {rows.length} appointment{rows.length === 1 ? '' : 's'}
        </span>
        <span style={{ marginLeft: 'auto', color: 'var(--mist)' }}>{collapsed ? '▸' : '▾'}</span>
      </button>

      {!collapsed && byDate.map(([date, dateRows]) => (
        <div key={date}>
          <div style={{
            padding: '8px 16px', background: 'var(--green-pale)', color: 'var(--green-dark)',
            fontSize: 11, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase',
            borderTop: '1px solid var(--pearl)',
          }}>
            {fmtDateLong(date)} · {dateRows.length} slot{dateRows.length === 1 ? '' : 's'}
          </div>
          {dateRows.map((r, idx) => (
            <ApptRow
              key={`${r.source}-${r.id ?? idx}-${r.appointment_time}`}
              row={r}
              isAdmin={isAdmin}
              onCancel={onCancel}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function ApptRow({ row, isAdmin, onCancel }: {
  row: AppointmentRow
  isAdmin: boolean
  onCancel: (row: AppointmentRow) => void
}) {
  const editable = row.source === 'beb-portal' && isAdmin
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      padding: '10px 16px', borderTop: '1px solid var(--pearl)',
      opacity: row.status === 'cancelled' ? 0.55 : 1,
    }}>
      <div style={{ minWidth: 80, fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>
        {fmtTime(row.appointment_time)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
            {row.customer_name || '(no name)'}
          </span>
          <SourceBadge source={row.source} />
          {row.is_walkin && (
            <span style={{
              fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 99,
              background: '#FEF3C7', color: '#92400E', textTransform: 'uppercase', letterSpacing: '.04em',
            }}>
              walk-in
            </span>
          )}
          {row.status && row.status !== 'confirmed' && (
            <span style={{
              fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 99,
              background: '#fee2e2', color: '#991b1b', textTransform: 'uppercase', letterSpacing: '.04em',
            }}>
              {row.status}
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 2 }}>
          {[
            row.customer_phone && formatPhoneDisplay(row.customer_phone),
            row.customer_email,
            row.appointment_employee_name && `Spiff: ${row.appointment_employee_name}`,
          ].filter(Boolean).join(' · ')}
        </div>
        {(row.items_bringing.length > 0 || row.how_heard.length > 0) && (
          <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 2 }}>
            {row.items_bringing.length > 0 && <>Bringing: {row.items_bringing.join(', ')}</>}
            {row.items_bringing.length > 0 && row.how_heard.length > 0 && ' · '}
            {row.how_heard.length > 0 && <>Heard via: {row.how_heard.join(', ')}</>}
          </div>
        )}
      </div>
      {editable && row.status !== 'cancelled' && (
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <a
            href={`/book/manage/${row.cancel_token}`}
            target="_blank"
            rel="noreferrer"
            className="btn-outline btn-sm"
          >
            Manage
          </a>
          <button onClick={() => onCancel(row)} className="btn-danger btn-sm">Cancel</button>
        </div>
      )}
    </div>
  )
}

function SourceBadge({ source }: { source: Source }) {
  if (source === 'beb-portal') {
    return (
      <span style={{
        fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 99,
        background: '#D1FAE5', color: '#065F46', textTransform: 'uppercase', letterSpacing: '.04em',
      }}>
        BEB
      </span>
    )
  }
  return (
    <span style={{
      fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 99,
      background: '#E5E7EB', color: '#374151', textTransform: 'uppercase', letterSpacing: '.04em',
    }}>
      Google
    </span>
  )
}
