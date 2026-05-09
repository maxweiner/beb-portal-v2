'use client'

// Sheet-style view of buying events. A different render of the same
// `events` rows the Hub / Slim / Legacy views read; no new entity.
//
// Editable in-cell:
//   - Store (dropdown)
//   - Start date (events span 3 days from start; no end_date column)
//   - Status (reserved ↔ scheduled only — cancellation goes through
//     CancelEventModal because it has cascades)
//   - Buyers Needed (numeric)
//   - Four pre-event readiness checkboxes, each auto-stamps *_at +
//     *_by_user_id (matching the existing override columns).
//
// Read-only here (click → Hub for the full editor):
//   - Workers (count vs. needed)
//   - Spend totals
//
// Add row at the bottom for a quick scheduled event. Save-the-Date
// (status='reserved') is still done via the existing button up top —
// keeping that flow consistent with how reserved events are usually
// created.

import { useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type { Event, EventStatus, Store, User } from '@/types'
import { eventSpend } from '@/lib/eventSpend'
import { fmtMoney } from '@/lib/format'
import { formatEventRange, eventEndIso } from '@/lib/eventDates'
import Checkbox from '@/components/ui/Checkbox'
import DatePicker from '@/components/ui/DatePicker'

type RowSaveStatus = 'idle' | 'saving' | 'saved' | 'error'
type SortKey = 'date' | 'store' | 'spend'
type SortDir = 'asc' | 'desc'

const READINESS = [
  { key: 'staff_briefed',     label: 'Staff Briefed' },
  { key: 'travel_override',   label: 'Travel' },
  { key: 'marketing_override',label: 'Marketing' },
  { key: 'assets_override',   label: 'Assets' },
] as const
type ReadinessKey = typeof READINESS[number]['key']

const STATUS_LABEL: Record<EventStatus, string> = {
  reserved: 'Reserved',
  scheduled: 'Scheduled',
  completed: 'Completed',
  cancelled: 'Cancelled',
}
const STATUS_COLOR: Record<EventStatus, { bg: string; fg: string }> = {
  reserved:  { bg: '#FFFBEB', fg: '#92400E' },
  scheduled: { bg: '#FEF3C7', fg: '#92400E' },
  completed: { bg: '#DBEAFE', fg: '#1E40AF' },
  cancelled: { bg: '#E5E7EB', fg: '#374151' },
}

const HEADER_STYLE = {
  padding: '8px 10px',
  fontWeight: 800,
  fontSize: 10,
  textTransform: 'uppercase' as const,
  letterSpacing: '.04em',
  color: 'var(--mist)',
  textAlign: 'left' as const,
  whiteSpace: 'nowrap' as const,
  borderBottom: '1px solid var(--pearl)',
  background: 'var(--cream2)',
  position: 'sticky' as const,
  top: 0,
  zIndex: 1,
}
const CELL_STYLE = {
  padding: '6px 10px',
  borderTop: '1px solid var(--pearl)',
  verticalAlign: 'middle' as const,
}

function todayIso(): string {
  return new Date().toISOString()
}

function fmtShortDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
}

interface SheetProps {
  events: Event[]
}

export default function BuyingEventSheet({ events }: SheetProps) {
  const { user, users, stores, setEvents, events: ctxEvents } = useApp()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin' || !!user?.is_partner

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | EventStatus>('all')
  // Default: hide events whose 3-day window ended more than 30 days ago.
  const [showPast, setShowPast] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const activeStores = useMemo(
    () => stores
      .filter(s => s.active !== false)
      .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [stores],
  )

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const cutoff = (() => {
      const d = new Date()
      d.setDate(d.getDate() - 30)
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    })()
    let base = events.slice()
    if (statusFilter === 'all') {
      // Default-hide completed — they pile up over time and clutter the
      // working view. Use the 'completed' chip (or 'all' is misleading)
      // to bring them back.
      base = base.filter(e => (e.status || 'scheduled') !== 'completed')
    } else {
      base = base.filter(e => (e.status || 'scheduled') === statusFilter)
    }
    if (!showPast) base = base.filter(e => !e.start_date || eventEndIso(e.start_date) >= cutoff)
    if (q) {
      base = base.filter(e => {
        const blob = [e.store_name, e.start_date].filter(Boolean).join(' ').toLowerCase()
        return blob.includes(q)
      })
    }
    const dir = sortDir === 'asc' ? 1 : -1
    base.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'date':  cmp = (a.start_date || '').localeCompare(b.start_date || ''); break
        case 'store': cmp = (a.store_name || '').localeCompare(b.store_name || ''); break
        case 'spend': cmp = eventSpend(a) - eventSpend(b); break
      }
      return cmp * dir
    })
    return base
  }, [events, search, statusFilter, showPast, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir(key === 'date' ? 'desc' : 'asc') }
  }
  function arrow(key: SortKey) {
    if (key !== sortKey) return ''
    return sortDir === 'asc' ? ' ↑' : ' ↓'
  }

  function applyLocalUpdate(id: string, patch: Partial<Event>) {
    setEvents(ctxEvents.map(e => e.id === id ? { ...e, ...patch } : e))
  }

  return (
    <div>
      {/* Top control bar */}
      <div className="card" style={{ marginBottom: 10, padding: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search store…"
          style={{ flex: '1 1 200px', maxWidth: 320, fontSize: 12, padding: '6px 10px' }}
        />
        {(['all', 'scheduled', 'reserved', 'completed', 'cancelled'] as const).map(f => (
          <button key={f} onClick={() => setStatusFilter(f)}
            className={statusFilter === f ? 'btn-primary btn-xs' : 'btn-outline btn-xs'}
            style={{ textTransform: 'capitalize' }}>
            {f === 'reserved' ? '📌 reserved' : f}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setShowPast(p => !p)}
          className={showPast ? 'btn-primary btn-xs' : 'btn-outline btn-xs'}
          title={showPast ? 'Hide events older than 30 days' : 'Show all historical events'}
        >
          {showPast ? 'All time' : 'Recent'}
        </button>
        <span style={{ fontSize: 11, color: 'var(--mist)' }}>{visible.length} of {events.length}</span>
      </div>

      <div style={{ background: '#fff', border: '1px solid var(--pearl)', borderRadius: 8, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ ...HEADER_STYLE, cursor: 'pointer' }} onClick={() => toggleSort('date')}>Dates{arrow('date')}</th>
              <th style={{ ...HEADER_STYLE, cursor: 'pointer' }} onClick={() => toggleSort('store')}>Store{arrow('store')}</th>
              <th style={HEADER_STYLE}>Status</th>
              <th style={{ ...HEADER_STYLE, textAlign: 'center' }}>Buyers</th>
              <th style={{ ...HEADER_STYLE, textAlign: 'center' }}>Workers</th>
              {READINESS.map(r => (
                <th key={r.key} style={{ ...HEADER_STYLE, textAlign: 'center' }}>{r.label}</th>
              ))}
              <th style={{ ...HEADER_STYLE, textAlign: 'right', cursor: 'pointer' }} onClick={() => toggleSort('spend')}>Spend{arrow('spend')}</th>
              <th style={{ ...HEADER_STYLE, width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {visible.map(e => (
              <SheetRow
                key={e.id}
                ev={e}
                users={users}
                stores={activeStores}
                currentUserId={user?.id || null}
                isAdmin={isAdmin}
                onLocalUpdate={(patch) => applyLocalUpdate(e.id, patch)}
              />
            ))}
            {isAdmin && (
              <AddRow
                stores={activeStores}
                afterCreate={(ev) => setEvents([ev, ...ctxEvents])}
              />
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SheetRow({
  ev, users, stores, currentUserId, isAdmin, onLocalUpdate,
}: {
  ev: Event
  users: User[]
  stores: Store[]
  currentUserId: string | null
  isAdmin: boolean
  onLocalUpdate: (patch: Partial<Event>) => void
}) {
  const [status, setStatus] = useState<RowSaveStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  async function save(patch: Partial<Event>) {
    // Capture pre-patch values for the columns we're touching, so we
    // can roll the optimistic update back if the DB rejects (e.g. the
    // overlap trigger throws on a colliding start_date).
    const rollback: Partial<Event> = {}
    for (const k of Object.keys(patch) as (keyof Event)[]) {
      ;(rollback as any)[k] = (ev as any)[k] ?? null
    }
    onLocalUpdate(patch)
    setStatus('saving'); setError(null)
    try {
      const { error: err } = await supabase.from('events').update(patch).eq('id', ev.id)
      if (err) throw new Error(err.message)
      setStatus('saved')
      setTimeout(() => setStatus(s => (s === 'saved' ? 'idle' : s)), 1500)
    } catch (e: any) {
      onLocalUpdate(rollback)
      setStatus('error')
      setError(e?.message || 'Save failed')
    }
  }

  function toggleReadiness(key: ReadinessKey, next: boolean) {
    const atKey = `${key}_at` as const
    const byKey = `${key}_by_user_id` as const
    const patch: Partial<Event> = next
      ? { [atKey]: todayIso(), [byKey]: currentUserId } as any
      : { [atKey]: null, [byKey]: null } as any
    void save(patch)
  }

  const evStatus: EventStatus = ev.status || 'scheduled'
  const sc = STATUS_COLOR[evStatus]
  const isCancelled = evStatus === 'cancelled'

  const workerCount = (ev.workers || []).filter(w => !w.deleted).length
  const need = ev.buyers_needed ?? null
  const understaffed = need != null && workerCount < need

  const totalSpend = eventSpend(ev)

  return (
    <tr style={{
      opacity: isCancelled ? 0.55 : 1,
      background: evStatus === 'reserved' ? '#FFFBEB' : '#fff',
    }}>
      {/* Dates */}
      <td style={{ ...CELL_STYLE, minWidth: 160 }}>
        {isAdmin && !isCancelled ? (
          <DatePicker
            value={ev.start_date}
            onChange={v => v && save({ start_date: v })}
          />
        ) : (
          <span style={{ fontWeight: 600 }}>
            {ev.start_date ? formatEventRange(ev.start_date) : '—'}
          </span>
        )}
      </td>

      {/* Store */}
      <td style={{ ...CELL_STYLE, minWidth: 180 }}>
        {isAdmin && !isCancelled ? (
          <select
            value={ev.store_id}
            onChange={e => {
              const s = stores.find(x => x.id === e.target.value)
              save({ store_id: e.target.value, store_name: s?.name || ev.store_name } as any)
            }}
            style={cellSelectStyle}
          >
            {stores.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
            {!stores.find(s => s.id === ev.store_id) && (
              <option value={ev.store_id}>{ev.store_name || '(unknown)'}</option>
            )}
          </select>
        ) : (
          <span style={{ fontWeight: 700 }}>{ev.store_name}</span>
        )}
      </td>

      {/* Status */}
      <td style={{ ...CELL_STYLE, whiteSpace: 'nowrap' }}>
        {isAdmin && !isCancelled ? (
          <select
            value={evStatus}
            onChange={e => save({ status: e.target.value as EventStatus })}
            style={cellSelectStyle}
          >
            <option value="scheduled">Scheduled</option>
            <option value="reserved">📌 Reserved</option>
            <option value="completed">Completed</option>
          </select>
        ) : (
          <span style={{
            background: sc.bg, color: sc.fg,
            padding: '2px 8px', borderRadius: 999,
            fontSize: 10, fontWeight: 800,
            textTransform: 'uppercase', letterSpacing: '.04em',
          }}>{STATUS_LABEL[evStatus]}</span>
        )}
      </td>

      {/* Buyers Needed */}
      <td style={{ ...CELL_STYLE, textAlign: 'center' }}>
        {isAdmin && !isCancelled ? (
          <input
            type="number"
            min={0}
            value={ev.buyers_needed ?? ''}
            onChange={e => {
              const v = e.target.value === '' ? null : Number(e.target.value)
              save({ buyers_needed: v as any })
            }}
            style={{
              width: 50, fontSize: 12, padding: '4px 6px',
              border: '1px solid var(--pearl)', borderRadius: 4,
              background: '#fff', textAlign: 'center',
            }}
          />
        ) : (
          <span>{ev.buyers_needed ?? '—'}</span>
        )}
      </td>

      {/* Workers count */}
      <td style={{ ...CELL_STYLE, textAlign: 'center', whiteSpace: 'nowrap' }}>
        <span style={{
          fontWeight: 600,
          color: understaffed ? '#b45309' : 'var(--ink)',
        }}>
          {workerCount}{need != null ? ` / ${need}` : ''}
        </span>
      </td>

      {/* Readiness checkboxes */}
      {READINESS.map(r => {
        const atKey = `${r.key}_at` as keyof Event
        const checked = !!(ev as any)[atKey]
        return (
          <td key={r.key} style={{ ...CELL_STYLE, textAlign: 'center', whiteSpace: 'nowrap' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Checkbox
                checked={checked}
                onChange={v => toggleReadiness(r.key, v)}
                disabled={!isAdmin || isCancelled}
                size={18}
              />
              {checked && (
                <span style={{ fontSize: 10, color: 'var(--mist)' }}>
                  {fmtShortDate((ev as any)[atKey])}
                </span>
              )}
            </div>
          </td>
        )
      })}

      {/* Spend total */}
      <td style={{ ...CELL_STYLE, textAlign: 'right', whiteSpace: 'nowrap' }}>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(totalSpend)}</span>
      </td>

      {/* Save indicator */}
      <td style={{ ...CELL_STYLE, textAlign: 'right' }}>
        <SaveIndicator status={status} error={error} />
      </td>
    </tr>
  )
}

function AddRow({
  stores, afterCreate,
}: {
  stores: Store[]
  afterCreate: (ev: Event) => void
}) {
  const { user, brand } = useApp()
  const [storeId, setStoreId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [buyersNeeded, setBuyersNeeded] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const valid = !!storeId && !!startDate

  async function submit() {
    if (!valid) return
    setBusy(true); setErr(null)
    try {
      const s = stores.find(x => x.id === storeId)
      const payload: any = {
        brand,
        store_id: storeId,
        store_name: s?.name || '',
        start_date: startDate,
        status: 'scheduled',
        created_by: user?.id || null,
      }
      if (buyersNeeded !== '') payload.buyers_needed = Number(buyersNeeded)
      const { data, error: insertErr } = await supabase.from('events').insert(payload).select('*').single()
      if (insertErr) throw new Error(insertErr.message)
      afterCreate({ ...(data as any), days: [] } as Event)
      setStoreId(''); setStartDate(''); setBuyersNeeded('')
    } catch (e: any) {
      setErr(e?.message || 'Failed to create')
    }
    setBusy(false)
  }

  return (
    <tr style={{ background: '#FAFAF7' }}>
      <td style={{ ...CELL_STYLE, minWidth: 160 }}>
        <DatePicker value={startDate} onChange={setStartDate} />
      </td>
      <td style={{ ...CELL_STYLE, minWidth: 180 }}>
        <select
          value={storeId}
          onChange={e => setStoreId(e.target.value)}
          style={cellSelectStyle}
        >
          <option value="">+ Pick store…</option>
          {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </td>
      <td style={CELL_STYLE} />
      <td style={{ ...CELL_STYLE, textAlign: 'center' }}>
        <input
          type="number"
          min={0}
          placeholder="—"
          value={buyersNeeded}
          onChange={e => setBuyersNeeded(e.target.value)}
          style={{
            width: 50, fontSize: 12, padding: '4px 6px',
            border: '1px solid var(--pearl)', borderRadius: 4,
            background: '#fff', textAlign: 'center',
          }}
        />
      </td>
      <td style={CELL_STYLE} />
      {READINESS.map(r => <td key={r.key} style={CELL_STYLE} />)}
      <td style={CELL_STYLE} />
      <td style={{ ...CELL_STYLE, textAlign: 'right', whiteSpace: 'nowrap' }}>
        <button
          onClick={submit}
          disabled={!valid || busy}
          className="btn-primary btn-xs"
          title={valid ? 'Add event' : 'Pick store + date first'}
        >
          {busy ? '…' : '+ Add'}
        </button>
        {err && (
          <div style={{ color: '#991B1B', fontSize: 10, marginTop: 2 }}>{err}</div>
        )}
      </td>
    </tr>
  )
}

function SaveIndicator({ status, error }: { status: RowSaveStatus; error: string | null }) {
  if (status === 'idle') return null
  if (status === 'saving') return <span style={{ fontSize: 10, color: 'var(--mist)' }}>⟳</span>
  if (status === 'saved') return <span style={{ fontSize: 10, color: 'var(--green)' }}>✓</span>
  return <span style={{ fontSize: 10, color: '#ef4444' }} title={error || 'Save failed'}>⚠</span>
}

const cellSelectStyle = {
  fontSize: 12,
  padding: '4px 6px',
  border: '1px solid var(--pearl)',
  borderRadius: 4,
  background: '#fff',
  fontFamily: 'inherit',
  width: '100%',
  cursor: 'pointer',
} as const
