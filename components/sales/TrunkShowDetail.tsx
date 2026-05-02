'use client'

// Trunk Show detail page. Phase 10: store / dates / rep / status
// / notes editable; per-day open + close hours grid. Later phases
// add special requests, customer appointment slots, and spiffs.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import { useAutosave, AutosaveIndicator } from '@/lib/useAutosave'
import {
  getTrunkShow, updateTrunkShow, softDeleteTrunkShow,
  listHours, setHoursForDate, reconcileHours,
  enumerateDates, effectiveStatus,
} from '@/lib/sales/trunkShows'
import type { TrunkShow, TrunkShowHours, TrunkShowStatus } from '@/types'

interface Props {
  trunkShowId: string
  onBack: () => void
  onChanged: () => void
  onDeleted: () => void
}

export default function TrunkShowDetail({ trunkShowId, onBack, onChanged, onDeleted }: Props) {
  const { user, stores, users } = useApp()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin' || !!user?.is_partner
  const [show, setShow] = useState<TrunkShow | null>(null)
  const [hours, setHours] = useState<TrunkShowHours[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState({
    store_id: '', start_date: '', end_date: '',
    assigned_rep_id: '', status: 'scheduled' as TrunkShowStatus, notes: '',
  })

  const repOptions = useMemo(() => users
    .filter(u => u.active !== false)
    .filter(u => u.role === 'sales_rep' || u.role === 'admin' || u.role === 'superadmin' || u.is_partner)
    .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
  [users])

  const canMutate = isAdmin || (show && user?.id === show.assigned_rep_id)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const row = await getTrunkShow(trunkShowId)
        if (cancelled) return
        if (!row) { setError('Trunk show not found.'); setLoaded(true); return }
        setShow(row)
        setDraft({
          store_id: row.store_id,
          start_date: row.start_date,
          end_date: row.end_date,
          assigned_rep_id: row.assigned_rep_id,
          status: row.status,
          notes: row.notes || '',
        })
        const hrs = await listHours(trunkShowId)
        if (cancelled) return
        setHours(hrs)
        setLoaded(true)
      } catch (err: any) {
        if (!cancelled) { setError(err?.message || 'Failed to load'); setLoaded(true) }
      }
    })()
    return () => { cancelled = true }
  }, [trunkShowId])

  // Save show fields. Reconcile hours rows when start/end change.
  const status = useAutosave(
    draft,
    async (d) => {
      if (!show || !canMutate) return
      const datesChanged = d.start_date !== show.start_date || d.end_date !== show.end_date
      await updateTrunkShow(show.id, {
        store_id: d.store_id,
        start_date: d.start_date,
        end_date:   d.end_date,
        assigned_rep_id: d.assigned_rep_id,
        status: d.status,
        notes: d.notes,
      })
      if (datesChanged) {
        await reconcileHours(show.id, d.start_date, d.end_date)
        const hrs = await listHours(show.id)
        setHours(hrs)
        setShow({ ...show, start_date: d.start_date, end_date: d.end_date })
      }
      onChanged()
    },
    { delay: 800, enabled: loaded && !!show && !!draft.store_id && !!draft.start_date
                          && !!draft.end_date && !!draft.assigned_rep_id && !!canMutate },
  )

  async function handleHoursChange(date: string, openTime: string, closeTime: string) {
    if (!show || !canMutate) return
    if (closeTime <= openTime) return
    setHours(prev => prev.map(h => h.show_date === date ? { ...h, open_time: openTime, close_time: closeTime } : h))
    try {
      await setHoursForDate(show.id, date, openTime, closeTime)
    } catch (err: any) {
      alert(err?.message || 'Could not save hours')
    }
  }

  async function handleDelete() {
    if (!show || !isAdmin) return
    if (!confirm(`Delete trunk show at ${stores.find(s => s.id === show.store_id)?.name || 'store'}?`)) return
    try { await softDeleteTrunkShow(show.id); onDeleted() }
    catch (err: any) { alert(err?.message || 'Could not delete') }
  }

  if (!loaded) return <div className="p-6 text-center" style={{ color: 'var(--mist)' }}>Loading…</div>
  if (error || !show) return (
    <div className="p-6" style={{ maxWidth: 720, margin: '0 auto' }}>
      <button onClick={onBack} className="btn-outline btn-sm" style={{ marginBottom: 14 }}>← Trunk Shows</button>
      <div className="card" style={{ padding: 20, color: '#991B1B', background: '#FEE2E2' }}>{error || 'Not found'}</div>
    </div>
  )

  const store = stores.find(s => s.id === show.store_id)
  const eff = effectiveStatus({ ...show, status: draft.status })

  return (
    <div className="p-6" style={{ maxWidth: 880, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <button onClick={onBack} className="btn-outline btn-sm">← Trunk Shows</button>
        <div style={{ flex: 1 }} />
        <AutosaveIndicator status={status} />
        {isAdmin && (
          <button onClick={handleDelete} className="btn-outline btn-sm" style={{ color: '#B91C1C', borderColor: '#FCA5A5' }}>Delete</button>
        )}
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)' }}>{store?.name || '(unknown store)'}</h1>
          <span style={{
            padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 800,
            textTransform: 'uppercase', letterSpacing: '.04em',
            background: 'var(--green-pale)', color: 'var(--green-dark)',
            border: '1px solid var(--green3)',
          }}>
            {eff.replace('_', ' ')}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Store" required>
            <select value={draft.store_id} onChange={e => setDraft(p => ({ ...p, store_id: e.target.value }))} disabled={!canMutate}>
              {stores.filter(s => s.active !== false).sort((a, b) => a.name.localeCompare(b.name)).map(s => (
                <option key={s.id} value={s.id}>{s.name}{s.city ? ` · ${s.city}, ${s.state}` : ''}</option>
              ))}
            </select>
          </Field>
          <Field label="Assigned rep" required>
            <select value={draft.assigned_rep_id} onChange={e => setDraft(p => ({ ...p, assigned_rep_id: e.target.value }))} disabled={!canMutate}>
              {repOptions.map(u => (
                <option key={u.id} value={u.id}>{u.name} · {u.role.replace('_', ' ')}</option>
              ))}
            </select>
          </Field>
          <Field label="Start date" required>
            <input type="date" value={draft.start_date} onChange={e => setDraft(p => ({ ...p, start_date: e.target.value }))} disabled={!canMutate} />
          </Field>
          <Field label="End date" required>
            <input type="date" value={draft.end_date} onChange={e => setDraft(p => ({ ...p, end_date: e.target.value }))} disabled={!canMutate} />
          </Field>
          <Field label="Status">
            <select value={draft.status} onChange={e => setDraft(p => ({ ...p, status: e.target.value as TrunkShowStatus }))} disabled={!canMutate}>
              <option value="scheduled">Scheduled</option>
              <option value="in_progress">In progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </Field>
        </div>
        <Field label="Notes">
          <textarea rows={3} value={draft.notes} onChange={e => setDraft(p => ({ ...p, notes: e.target.value }))} disabled={!canMutate} />
        </Field>
      </div>

      {/* Per-day hours */}
      <div className="card" style={{ padding: 20, marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)', marginBottom: 4 }}>🕒 Hours</div>
        <div style={{ fontSize: 11, color: 'var(--mist)', marginBottom: 10 }}>
          One row per show date. Defaults to 10am – 5pm; edit any row to adjust that day.
        </div>
        {hours.length === 0 ? (
          <div style={{ padding: 12, textAlign: 'center', color: 'var(--mist)', fontStyle: 'italic', fontSize: 13 }}>
            Set start &amp; end dates to populate the hours grid.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {hours.map(h => (
              <HoursRow key={h.id} h={h} canWrite={!!canMutate} onChange={handleHoursChange} />
            ))}
          </div>
        )}
      </div>

      {/* Phase placeholders */}
      <div className="card" style={{ padding: 18, marginBottom: 14, opacity: 0.7 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>Coming soon on this page</div>
        <ul style={{ fontSize: 12, color: 'var(--mist)', lineHeight: 1.6, paddingLeft: 18, margin: 0 }}>
          <li>Special requests + office staff notifications — Phase 11</li>
          <li>Customer appointment slots (Trunk Customer Bookings) — Phase 12</li>
          <li>Spiff calculation + payouts — Phase 13</li>
        </ul>
      </div>
    </div>
  )
}

function HoursRow({ h, canWrite, onChange }: {
  h: TrunkShowHours
  canWrite: boolean
  onChange: (date: string, openTime: string, closeTime: string) => void
}) {
  const [open, setOpen] = useState(h.open_time.slice(0, 5))
  const [close, setClose] = useState(h.close_time.slice(0, 5))
  const fmtDay = new Date(h.show_date + 'T12:00:00')
    .toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      padding: '8px 12px', background: 'var(--cream)', borderRadius: 6,
    }}>
      <div style={{ minWidth: 200, fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{fmtDay}</div>
      <input type="time" value={open}
        onChange={e => setOpen(e.target.value)}
        onBlur={() => onChange(h.show_date, open, close)}
        disabled={!canWrite} style={{ width: 110 }} />
      <span style={{ color: 'var(--mist)' }}>–</span>
      <input type="time" value={close}
        onChange={e => setClose(e.target.value)}
        onBlur={() => onChange(h.show_date, open, close)}
        disabled={!canWrite} style={{ width: 110 }} />
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="field" style={{ marginBottom: 8 }}>
      <label className="fl">{label}{required && <span style={{ color: '#B91C1C', marginLeft: 4 }}>*</span>}</label>
      {children}
    </div>
  )
}
