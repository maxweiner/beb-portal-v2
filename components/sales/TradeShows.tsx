'use client'

// Trade Shows top-level page. Phase 3 ships the list view + Add
// Show form + click-to-detail flow. Filters by past/upcoming.
// Detail view at TradeShowDetail covers edit + soft-delete.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import {
  listTradeShows, createTradeShow, type TradeShowDraft,
} from '@/lib/sales/tradeshows'
import type { TradeShow } from '@/types'
import TradeShowDetail from './TradeShowDetail'
import DatePicker from '@/components/ui/DatePicker'

type Filter = 'all' | 'upcoming' | 'past'

export default function TradeShows() {
  const { user } = useApp()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin' || !!user?.is_partner

  const [rows, setRows] = useState<TradeShow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  async function reload() {
    setError(null)
    try {
      setRows(await listTradeShows())
    } catch (err: any) {
      setError(err?.message || 'Failed to load')
    }
    setLoaded(true)
  }
  useEffect(() => { reload() }, [])

  const todayIso = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  }, [])

  const filtered = useMemo(() => rows.filter(r => {
    if (filter === 'upcoming') return r.end_date >= todayIso
    if (filter === 'past') return r.end_date < todayIso
    return true
  }), [rows, filter, todayIso])

  if (openId) {
    return (
      <TradeShowDetail
        tradeShowId={openId}
        onBack={() => setOpenId(null)}
        onDeleted={() => { setOpenId(null); void reload() }}
      />
    )
  }

  return (
    <div className="p-6" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)' }}>🎪 Trade Shows</h1>
        {isAdmin && (
          <button className="btn-primary btn-sm" onClick={() => setCreateOpen(true)}>+ New Trade Show</button>
        )}
      </div>

      {/* Filter pills */}
      <div className="card" style={{ marginBottom: 12, padding: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['all', 'upcoming', 'past'] as Filter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={filter === f ? 'btn-primary btn-xs' : 'btn-outline btn-xs'}
            style={{ textTransform: 'capitalize' }}
          >{f}</button>
        ))}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--mist)' }}>{filtered.length} of {rows.length}</span>
      </div>

      {error && (
        <div className="card" style={{ padding: 14, marginBottom: 12, background: '#FEE2E2', color: '#991B1B' }}>{error}</div>
      )}

      {!loaded ? (
        <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--mist)' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--mist)' }}>
          {rows.length === 0
            ? 'No trade shows yet.' + (isAdmin ? ' Click "+ New Trade Show" to create one.' : '')
            : 'Nothing matches the current filter.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(r => (
            <button
              key={r.id}
              onClick={() => setOpenId(r.id)}
              className="card"
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '14px 18px', cursor: 'pointer', fontFamily: 'inherit',
                background: '#fff',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>{r.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 2 }}>
                    {r.venue_city || r.venue_state
                      ? `${r.venue_city || ''}${r.venue_city && r.venue_state ? ', ' : ''}${r.venue_state || ''}`
                      : r.venue_name || ''}
                    {(r.venue_city || r.venue_state || r.venue_name) && ' · '}
                    {fmtRange(r.start_date, r.end_date)}
                    {r.booth_number ? ` · Booth ${r.booth_number}` : ''}
                  </div>
                </div>
                <span style={{
                  background: r.end_date >= todayIso ? 'var(--green-pale)' : 'var(--cream2)',
                  color: r.end_date >= todayIso ? 'var(--green-dark)' : 'var(--mist)',
                  padding: '2px 10px', borderRadius: 999,
                  fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap',
                  textTransform: 'uppercase', letterSpacing: '.04em',
                }}>{r.end_date >= todayIso ? 'Upcoming' : 'Past'}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {createOpen && (
        <CreateTradeShowModal
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => { setCreateOpen(false); void reload(); setOpenId(id) }}
        />
      )}
    </div>
  )
}

function fmtRange(start: string, end: string): string {
  const s = new Date(start + 'T12:00:00')
  const e = new Date(end + 'T12:00:00')
  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()
  const sameDay = start === end
  if (sameDay) {
    return s.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  if (sameMonth) {
    return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}–${e.getDate()}, ${e.getFullYear()}`
  }
  return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
}

/* ── Create modal ─────────────────────────────────────────── */

function CreateTradeShowModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [draft, setDraft] = useState<TradeShowDraft>({
    name: '', start_date: '', end_date: '',
    venue_name: '', venue_city: '', venue_state: '',
    booth_number: '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const valid = !!draft.name.trim() && !!draft.start_date && !!draft.end_date
                 && draft.end_date >= draft.start_date

  async function handleCreate() {
    if (!valid || busy) return
    setBusy(true); setErr(null)
    try {
      const norm = (v?: string | null) => (v && v.trim() ? v.trim() : null)
      const created = await createTradeShow({
        name:           draft.name.trim(),
        start_date:     draft.start_date,
        end_date:       draft.end_date,
        venue_name:     norm(draft.venue_name),
        venue_city:     norm(draft.venue_city),
        venue_state:    norm(draft.venue_state),
        booth_number:   norm(draft.booth_number),
      })
      onCreated(created.id)
    } catch (e: any) {
      setErr(e?.message || 'Failed to create')
      setBusy(false)
    }
  }

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1100,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 16px',
      }}>
      <div style={{ width: 'min(560px, 100%)', background: '#fff', borderRadius: 12, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>New Trade Show</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--mist)' }}>×</button>
        </div>

        <div className="field" style={{ marginBottom: 10 }}>
          <label className="fl">Show name *</label>
          <input value={draft.name} onChange={e => setDraft(p => ({ ...p, name: e.target.value }))}
            placeholder="e.g. JCK Las Vegas 2026" autoFocus />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{ marginBottom: 10 }}>
          <div className="field">
            <label className="fl">Start *</label>
            <DatePicker value={draft.start_date}
              onChange={v => setDraft(p => ({ ...p, start_date: v }))} />
          </div>
          <div className="field">
            <label className="fl">End *</label>
            <DatePicker value={draft.end_date}
              onChange={v => setDraft(p => ({ ...p, end_date: v }))} />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{ marginBottom: 10 }}>
          <div className="field">
            <label className="fl">City</label>
            <input value={draft.venue_city || ''}
              onChange={e => setDraft(p => ({ ...p, venue_city: e.target.value }))} />
          </div>
          <div className="field">
            <label className="fl">State</label>
            <input value={draft.venue_state || ''}
              onChange={e => setDraft(p => ({ ...p, venue_state: e.target.value }))} />
          </div>
        </div>
        <div className="field" style={{ marginBottom: 14 }}>
          <label className="fl">Booth number (optional)</label>
          <input value={draft.booth_number || ''}
            onChange={e => setDraft(p => ({ ...p, booth_number: e.target.value }))} />
        </div>

        {err && (
          <div style={{ background: '#FEE2E2', color: '#991B1B', padding: '8px 10px', borderRadius: 6, fontSize: 13, marginBottom: 10 }}>
            {err}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} className="btn-outline btn-sm">Cancel</button>
          <button onClick={handleCreate} disabled={!valid || busy} className="btn-primary btn-sm">
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--mist)' }}>
          Add booth costs, staff assignments, leads, and appointments after creation — or fill the rest of the venue / website / notes on the detail page.
        </div>
      </div>
    </div>
  )
}
