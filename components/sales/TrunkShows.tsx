'use client'

// Trunk Shows top-level page. Phase 10: list + create + click-to-
// detail. Detail covers per-day hours editing; later phases layer
// on special requests, customer appointment slots, and spiffs.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import {
  listTrunkShows, createTrunkShow, effectiveStatus,
  type TrunkShowDraft,
} from '@/lib/sales/trunkShows'
import type { TrunkShow, TrunkShowStatus } from '@/types'
import TrunkShowDetail from './TrunkShowDetail'

const STATUS_LABEL: Record<TrunkShowStatus, string> = {
  scheduled: 'Scheduled', in_progress: 'In Progress',
  completed: 'Completed', cancelled: 'Cancelled',
}
const STATUS_COLOR: Record<TrunkShowStatus, { bg: string; fg: string }> = {
  scheduled:   { bg: '#FEF3C7', fg: '#92400E' },
  in_progress: { bg: '#D1FAE5', fg: '#065F46' },
  completed:   { bg: '#DBEAFE', fg: '#1E40AF' },
  cancelled:   { bg: '#E5E7EB', fg: '#374151' },
}

type Filter = 'all' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled'

export default function TrunkShows() {
  const { user, stores, users } = useApp()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin' || !!user?.is_partner

  const [rows, setRows] = useState<TrunkShow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  async function reload() {
    setError(null)
    try { setRows(await listTrunkShows()) }
    catch (err: any) { setError(err?.message || 'Failed to load') }
    setLoaded(true)
  }
  useEffect(() => { void reload() }, [])

  const storesById = useMemo(() => new Map(stores.map(s => [s.id, s])), [stores])
  const usersById  = useMemo(() => new Map(users.map(u => [u.id, u])), [users])

  const filtered = useMemo(() => rows.filter(r => {
    if (filter === 'all') return true
    return effectiveStatus(r) === filter
  }), [rows, filter])

  if (openId) {
    return (
      <TrunkShowDetail
        trunkShowId={openId}
        onBack={() => setOpenId(null)}
        onChanged={() => void reload()}
        onDeleted={() => { setOpenId(null); void reload() }}
      />
    )
  }

  return (
    <div className="p-6" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)' }}>🛍️ Trunk Shows</h1>
        {isAdmin && (
          <button className="btn-primary btn-sm" onClick={() => setCreateOpen(true)}>+ New Trunk Show</button>
        )}
      </div>

      <div className="card" style={{ marginBottom: 12, padding: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['all', 'scheduled', 'in_progress', 'completed', 'cancelled'] as Filter[]).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={filter === f ? 'btn-primary btn-xs' : 'btn-outline btn-xs'}
            style={{ textTransform: 'capitalize' }}>{f.replace('_', ' ')}</button>
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
            ? 'No trunk shows yet.' + (isAdmin ? ' Click "+ New Trunk Show".' : '')
            : 'Nothing matches the current filter.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(r => {
            const status = effectiveStatus(r)
            const sc = STATUS_COLOR[status]
            const store = storesById.get(r.store_id)
            const rep = usersById.get(r.assigned_rep_id)
            return (
              <button key={r.id} onClick={() => setOpenId(r.id)} className="card"
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '14px 18px', cursor: 'pointer', fontFamily: 'inherit',
                  background: '#fff',
                }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>
                      {store?.name || '(unknown store)'}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 2 }}>
                      {[store?.city, store?.state].filter(Boolean).join(', ')}
                      {(store?.city || store?.state) && ' · '}
                      {fmtRange(r.start_date, r.end_date)}
                      {rep && <> · Rep: <strong>{rep.name?.split(' ')[0] || rep.name}</strong></>}
                    </div>
                  </div>
                  <span style={{
                    background: sc.bg, color: sc.fg,
                    padding: '2px 10px', borderRadius: 999,
                    fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap',
                    textTransform: 'uppercase', letterSpacing: '.04em',
                  }}>{STATUS_LABEL[status]}</span>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {createOpen && (
        <CreateTrunkShowModal
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
  const sameDay = start === end
  if (sameDay) return s.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()
  if (sameMonth) return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}–${e.getDate()}, ${e.getFullYear()}`
  return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
}

/* ── create modal ─────────────────────────────────────── */

function CreateTrunkShowModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { stores, users, user } = useApp()
  const [draft, setDraft] = useState<TrunkShowDraft>({
    store_id: '', start_date: '', end_date: '',
    assigned_rep_id: user?.role === 'sales_rep' ? user.id : '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [storeQuery, setStoreQuery] = useState('')

  const valid = !!draft.store_id && !!draft.start_date && !!draft.end_date
                 && draft.end_date >= draft.start_date && !!draft.assigned_rep_id

  // Trunk-rep pool: anyone with is_trunk_rep=TRUE (admin-toggled flag),
  // plus any partner so they can self-assign. Replaces the old role-based
  // filter — see users.is_trunk_rep migration.
  const repOptions = users
    .filter(u => u.active !== false)
    .filter(u => (u as any).is_trunk_rep === true || u.is_partner)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))

  const selectedStore = useMemo(
    () => stores.find(s => s.id === draft.store_id) || null,
    [stores, draft.store_id],
  )

  const filteredStores = useMemo(() => {
    const q = storeQuery.trim().toLowerCase()
    const base = stores.filter(s => s.active !== false)
    const list = q
      ? base.filter(s =>
          (s.name || '').toLowerCase().includes(q) ||
          (s.city || '').toLowerCase().includes(q) ||
          (s.state || '').toLowerCase().includes(q))
      : base
    return list.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  }, [stores, storeQuery])

  async function pickStore(s: { id: string; name: string }) {
    setDraft(p => ({ ...p, store_id: s.id }))
    setStoreQuery('')
    // Pre-fill assigned rep from the matching trunk_show_stores row
    // (case-insensitive name match) if it has a trunk_rep_user_id.
    const { data } = await supabase
      .from('trunk_show_stores')
      .select('trunk_rep_user_id')
      .ilike('name', s.name)
      .not('trunk_rep_user_id', 'is', null)
      .limit(1)
      .maybeSingle()
    if (data?.trunk_rep_user_id) {
      setDraft(p => ({ ...p, assigned_rep_id: data.trunk_rep_user_id }))
    }
  }

  async function submit() {
    if (!valid || busy) return
    setBusy(true); setErr(null)
    try {
      const created = await createTrunkShow(draft)
      onCreated(created.id)
    } catch (e: any) {
      setErr(e?.message || 'Could not create')
      setBusy(false)
    }
  }

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1100,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '6vh 16px',
      }}>
      <div style={{ width: 'min(560px, 100%)', background: '#fff', borderRadius: 12, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>New Trunk Show</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--mist)' }}>×</button>
        </div>

        <div className="field" style={{ marginBottom: 10 }}>
          <label className="fl">Store *</label>
          {selectedStore ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 10px', border: '1px solid var(--pearl)', borderRadius: 6, background: 'var(--pearl-pale, #F8FAFC)' }}>
              <div style={{ fontSize: 13 }}>
                <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{selectedStore.name}</span>
                {selectedStore.city ? <span style={{ color: 'var(--mist)' }}> · {selectedStore.city}, {selectedStore.state}</span> : null}
              </div>
              <button type="button" onClick={() => setDraft(p => ({ ...p, store_id: '' }))}
                style={{ background: 'transparent', border: 'none', color: 'var(--mist)', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                change
              </button>
            </div>
          ) : (
            <>
              <input type="text" value={storeQuery}
                onChange={e => setStoreQuery(e.target.value)}
                placeholder="Search by name, city, or state…"
                autoFocus />
              {filteredStores.length > 0 && (
                <div style={{ marginTop: 4, maxHeight: 220, overflowY: 'auto', border: '1px solid var(--pearl)', borderRadius: 6 }}>
                  {filteredStores.slice(0, 50).map(s => (
                    <button key={s.id} type="button" onClick={() => pickStore(s)}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', background: '#fff', border: 'none', borderBottom: '1px solid var(--pearl)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>
                      <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{s.name}</span>
                      {s.city ? <span style={{ color: 'var(--mist)' }}> · {s.city}, {s.state}</span> : null}
                    </button>
                  ))}
                  {filteredStores.length > 50 && (
                    <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--mist)', fontStyle: 'italic' }}>
                      Showing first 50 — refine your search to see more.
                    </div>
                  )}
                </div>
              )}
              {storeQuery && filteredStores.length === 0 && (
                <div style={{ marginTop: 4, padding: '8px 10px', fontSize: 12, color: 'var(--mist)', fontStyle: 'italic' }}>
                  No stores match.
                </div>
              )}
            </>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{ marginBottom: 10 }}>
          <div className="field">
            <label className="fl">Start *</label>
            <input type="date" value={draft.start_date}
              onChange={e => setDraft(p => ({ ...p, start_date: e.target.value }))} />
          </div>
          <div className="field">
            <label className="fl">End *</label>
            <input type="date" value={draft.end_date}
              onChange={e => setDraft(p => ({ ...p, end_date: e.target.value }))} />
          </div>
        </div>
        <div className="field" style={{ marginBottom: 14 }}>
          <label className="fl">Assigned rep *</label>
          <select value={draft.assigned_rep_id} onChange={e => setDraft(p => ({ ...p, assigned_rep_id: e.target.value }))}>
            <option value="">Pick a rep…</option>
            {repOptions.map(u => (
              <option key={u.id} value={u.id}>{u.name} · {u.role.replace('_', ' ')}</option>
            ))}
          </select>
        </div>

        {err && <div style={{ background: '#FEE2E2', color: '#991B1B', padding: '8px 10px', borderRadius: 6, fontSize: 13, marginBottom: 10 }}>{err}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} className="btn-outline btn-sm">Cancel</button>
          <button onClick={submit} disabled={!valid || busy} className="btn-primary btn-sm">
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--mist)' }}>
          Defaults each show day to 10am–5pm; edit per-day on the detail page.
        </div>
      </div>
    </div>
  )
}
