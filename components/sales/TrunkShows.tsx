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
import TrunkShowSheet from './TrunkShowSheet'
import DatePicker from '@/components/ui/DatePicker'

const STATUS_LABEL: Record<TrunkShowStatus, string> = {
  reserved: '📌 Reserved',
  scheduled: 'Scheduled', in_progress: 'In Progress',
  completed: 'Completed', cancelled: 'Cancelled',
}
const STATUS_COLOR: Record<TrunkShowStatus, { bg: string; fg: string }> = {
  reserved:    { bg: '#FFFBEB', fg: '#92400E' },
  scheduled:   { bg: '#FEF3C7', fg: '#92400E' },
  in_progress: { bg: '#D1FAE5', fg: '#065F46' },
  completed:   { bg: '#DBEAFE', fg: '#1E40AF' },
  cancelled:   { bg: '#E5E7EB', fg: '#374151' },
}

type Filter = 'all' | 'reserved' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
type Sort = 'date-desc' | 'date-asc' | 'rep' | 'store'
type View = 'cards' | 'columns' | 'list' | 'sheet'

export default function TrunkShows({ setNav }: { setNav?: (n: import('@/app/page').NavPage) => void } = {}) {
  const { user, trunkShowStores, users, trunkShowIntent, setTrunkShowIntent } = useApp()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin' || !!user?.is_partner

  const [rows, setRows] = useState<TrunkShow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('date-desc')
  const [view, setView] = useState<View>('cards')
  // When true, the sheet view renders in a full-viewport modal
  // instead of inline beneath the sidebar. Trunk Shows is dense
  // enough that ~280px of sidebar chrome makes the sheet cramped
  // — Teri uses this view for long stretches and asked for the
  // whole screen. Toggled via a ⛶ button in the toolbar (only
  // visible when view === 'sheet') and ESC dismisses.
  const [sheetFullscreen, setSheetFullscreen] = useState(false)
  const [search, setSearch] = useState('')
  // Default: hide trunk shows whose end_date is more than 30 days ago.
  // Toggle to bring historical rows back into view.
  const [showPast, setShowPast] = useState(false)
  const [createOpen, setCreateOpen] = useState<false | 'scheduled' | 'reserved'>(false)
  const [openId, setOpenId] = useState<string | null>(null)

  // Deep-link from the calendar overlay — open the trunk show
  // detail directly instead of dropping the user on the list.
  useEffect(() => {
    if (!trunkShowIntent) return
    setOpenId(trunkShowIntent.trunkShowId)
    setTrunkShowIntent(null)
  }, [trunkShowIntent, setTrunkShowIntent])

  async function reload() {
    setError(null)
    try { setRows(await listTrunkShows()) }
    catch (err: any) { setError(err?.message || 'Failed to load') }
    setLoaded(true)
  }
  useEffect(() => { void reload() }, [])

  // ESC closes the fullscreen sheet workspace. Body scroll-lock
  // while open so the underlying page can't accidentally scroll
  // behind the modal.
  useEffect(() => {
    if (!sheetFullscreen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setSheetFullscreen(false)
    }
    document.addEventListener('keydown', onKey)
    const priorOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = priorOverflow
    }
  }, [sheetFullscreen])

  // Belt-and-suspenders: if the user switches AWAY from the sheet
  // view while the fullscreen modal is open, close the modal too.
  // (Can't normally happen because the trigger button is only
  // visible in sheet view, but defensive against state surprises.)
  useEffect(() => {
    if (view !== 'sheet' && sheetFullscreen) setSheetFullscreen(false)
  }, [view, sheetFullscreen])

  const storesById = useMemo(() => new Map(trunkShowStores.map(s => [s.id, s])), [trunkShowStores])
  const usersById  = useMemo(() => new Map(users.map(u => [u.id, u])), [users])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const repName = (r: TrunkShow) => (r.assigned_rep_id ? usersById.get(r.assigned_rep_id)?.name : null) || '~'
    const storeName = (r: TrunkShow) => storesById.get(r.store_id)?.name || '~'
    const cutoff = (() => {
      const d = new Date()
      d.setDate(d.getDate() - 30)
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    })()
    let base = rows.filter(r => filter === 'all' || effectiveStatus(r) === filter)
    if (!showPast) base = base.filter(r => r.end_date >= cutoff)
    if (q) {
      base = base.filter(r => {
        const store = storesById.get(r.store_id)
        const blob = [
          storeName(r),
          repName(r),
          store?.city, store?.state,
          r.notes,
        ].filter(Boolean).join(' ').toLowerCase()
        return blob.includes(q)
      })
    }
    return [...base].sort((a, b) => {
      switch (sort) {
        case 'date-asc':  return a.start_date.localeCompare(b.start_date)
        case 'rep':       return repName(a).localeCompare(repName(b)) || b.start_date.localeCompare(a.start_date)
        case 'store':     return storeName(a).localeCompare(storeName(b)) || b.start_date.localeCompare(a.start_date)
        case 'date-desc':
        default:          return b.start_date.localeCompare(a.start_date)
      }
    })
  }, [rows, filter, sort, search, showPast, usersById, storesById])

  if (openId) {
    return (
      <TrunkShowDetail
        trunkShowId={openId}
        onBack={() => setOpenId(null)}
        onChanged={() => void reload()}
        onDeleted={() => { setOpenId(null); void reload() }}
        setNav={setNav}
      />
    )
  }

  return (
    <div className="p-6" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)' }}>🛍️ Trunk Shows</h1>
        {isAdmin && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-primary btn-sm" onClick={() => setCreateOpen('scheduled')}>+ New Trunk Show</button>
            <button className="btn-outline btn-sm" onClick={() => setCreateOpen('reserved')}
              title="Tentative date — Save the Date">
              📌 Save the Date
            </button>
          </div>
        )}
      </div>

      {user?.trunk_show_calendar_subscribe_url && (
        <SubscribeCalendarBanner url={user.trunk_show_calendar_subscribe_url} />
      )}

      <div style={{ position: 'relative', marginBottom: 10 }}>
        <span style={{
          position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
          color: 'var(--mist)', fontSize: 13, pointerEvents: 'none',
        }}>🔍</span>
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by store, rep, city, or notes…"
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '9px 32px 9px 32px',
            fontSize: 13, fontFamily: 'inherit',
          }}
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            aria-label="Clear search"
            style={{
              position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--mist)', fontSize: 14, padding: 4, lineHeight: 1,
            }}
          >✕</button>
        )}
      </div>

      <div className="card" style={{ marginBottom: 12, padding: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['all', 'reserved', 'scheduled', 'in_progress', 'completed', 'cancelled'] as Filter[]).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={filter === f ? 'btn-primary btn-xs' : 'btn-outline btn-xs'}
            style={{ textTransform: 'capitalize' }}>{f.replace('_', ' ')}</button>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 4, background: 'var(--cream2)', padding: 2, borderRadius: 6 }}>
          {([['cards', '🗂'], ['columns', '🧱'], ['list', '☰'], ['sheet', '⊞']] as [View, string][]).map(([v, icon]) => (
            <button key={v} onClick={() => setView(v)}
              title={v}
              style={{
                background: view === v ? '#fff' : 'transparent',
                border: 'none', borderRadius: 4, padding: '2px 8px',
                cursor: 'pointer', fontSize: 13,
                boxShadow: view === v ? '0 1px 2px rgba(0,0,0,.06)' : 'none',
              }}>
              {icon}
            </button>
          ))}
        </div>
        {/* Fullscreen toggle — only renders in sheet view since the
            other view modes already fit comfortably in the inline
            chrome. ESC closes (handled in the useEffect above). */}
        {view === 'sheet' && (
          <button
            onClick={() => setSheetFullscreen(true)}
            className="btn-outline btn-xs"
            title="Open the sheet in a fullscreen workspace (ESC to close)"
          >
            ⛶ Fullscreen
          </button>
        )}
        <label style={{ fontSize: 11, color: 'var(--mist)', display: 'flex', alignItems: 'center', gap: 6 }}>
          Sort:
          <select value={sort} onChange={e => setSort(e.target.value as Sort)}
            style={{
              fontSize: 12, padding: '4px 24px 4px 8px',
              width: 'auto', minWidth: 130,
              border: '1px solid var(--pearl)', borderRadius: 6,
              background: '#fff', color: 'var(--ink)',
              fontFamily: 'inherit', cursor: 'pointer',
              appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none',
              backgroundImage: 'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\' viewBox=\'0 0 10 6\'><path d=\'M1 1l4 4 4-4\' stroke=\'%2364748b\' stroke-width=\'1.5\' fill=\'none\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/></svg>")',
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 8px center',
            }}>
            <option value="date-desc">Newest first</option>
            <option value="date-asc">Oldest first</option>
            <option value="rep">Trunk rep</option>
            <option value="store">Store name</option>
          </select>
        </label>
        <button
          onClick={() => setShowPast(p => !p)}
          className={showPast ? 'btn-primary btn-xs' : 'btn-outline btn-xs'}
          title={showPast ? 'Hide trunk shows older than 30 days' : 'Show all historical trunk shows'}
        >
          {showPast ? 'All time' : 'Recent'}
        </button>
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
            : search.trim()
              ? <>Nothing matches "<strong>{search}</strong>".</>
              : 'Nothing matches the current filter.'}
        </div>
      ) : view === 'cards' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(r => {
            const status = effectiveStatus(r)
            const sc = STATUS_COLOR[status]
            const store = storesById.get(r.store_id)
            const rep = r.assigned_rep_id ? usersById.get(r.assigned_rep_id) : null
            return (
              <button key={r.id} onClick={() => setOpenId(r.id)} className="card"
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '14px 18px', cursor: 'pointer', fontFamily: 'inherit',
                  background: status === 'reserved' ? '#FFFBEB' : '#fff',
                  border: status === 'reserved' ? '2px dashed #D97706' : undefined,
                  opacity: status === 'cancelled' ? 0.6 : 1,
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
      ) : view === 'columns' ? (
        <ColumnsView shows={filtered} usersById={usersById} storesById={storesById} onOpen={setOpenId} />
      ) : view === 'sheet' ? (
        // When the fullscreen modal is open the sheet renders inside
        // it instead — skip the inline render so TrunkShowSheet stays
        // a single-instance mount (avoids duplicate fetches / state
        // forks if the component ever gains internal state).
        sheetFullscreen ? null : (
          <TrunkShowSheet shows={filtered} onChanged={() => void reload()} onOpen={setOpenId} />
        )
      ) : (
        <ListView shows={filtered} usersById={usersById} storesById={storesById} onOpen={setOpenId} />
      )}

      {createOpen && (
        <CreateTrunkShowModal
          mode={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => { setCreateOpen(false); void reload(); setOpenId(id) }}
        />
      )}

      {/* Fullscreen sheet workspace — only mounts when the user
          opts in via the ⛶ toolbar button. Sits above the entire
          portal chrome (sidebar + content). ESC + the ✕ button
          close it; the ESC handler lives in a useEffect higher
          in this component so it can also un-lock body scroll. */}
      {sheetFullscreen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9000,
          background: 'var(--cream)',
          display: 'flex', flexDirection: 'column',
          fontFamily: 'inherit',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 16px',
            background: '#fff',
            borderBottom: '1px solid var(--pearl)',
            flexShrink: 0,
          }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--ink)' }}>
                📚 Trunk Shows · Sheet workspace
              </div>
              <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 2 }}>
                {filtered.length} of {rows.length} · ESC to close
              </div>
            </div>
            <button
              onClick={() => setSheetFullscreen(false)}
              className="btn-outline btn-sm"
              title="Close (ESC)"
            >
              ✕ Close
            </button>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
            <TrunkShowSheet shows={filtered} onChanged={() => void reload()} onOpen={setOpenId} />
          </div>
        </div>
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

function CreateTrunkShowModal({ mode, onClose, onCreated }: { mode: 'scheduled' | 'reserved'; onClose: () => void; onCreated: (id: string) => void }) {
  const { trunkShowStores, users, user } = useApp()
  const isReserved = mode === 'reserved'
  const [draft, setDraft] = useState<TrunkShowDraft>({
    store_id: '', start_date: '', end_date: '',
    assigned_rep_id: user?.role === 'sales_rep' ? user.id : '',
    status: mode,
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [storeQuery, setStoreQuery] = useState('')

  const missing: string[] = []
  if (!draft.store_id)        missing.push('store')
  if (!draft.start_date)      missing.push('start date')
  if (!draft.end_date)        missing.push('end date')
  if (draft.start_date && draft.end_date && draft.end_date < draft.start_date) missing.push('end date is before start date')
  if (!draft.assigned_rep_id) missing.push('assigned rep')
  const valid = missing.length === 0

  // Trunk rep pool only — must have is_trunk_rep flag set in
  // Admin → Users. Admins, partners, and other roles are NOT
  // implicitly trunk reps.
  const repOptions = users
    .filter(u => u.active !== false)
    .filter(u => (u as any).is_trunk_rep === true)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))

  const selectedStore = useMemo(
    () => trunkShowStores.find(s => s.id === draft.store_id) || null,
    [trunkShowStores, draft.store_id],
  )

  const filteredStores = useMemo(() => {
    const q = storeQuery.trim().toLowerCase()
    const base = trunkShowStores
    const list = q
      ? base.filter(s =>
          (s.name || '').toLowerCase().includes(q) ||
          (s.city || '').toLowerCase().includes(q) ||
          (s.state || '').toLowerCase().includes(q))
      : base
    return list.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  }, [trunkShowStores, storeQuery])

  async function pickStore(s: { id: string; name: string; trunk_rep_user_id?: string | null }) {
    setDraft(p => ({
      ...p,
      store_id: s.id,
      // Inherit the store's tagged trunk rep if the user hasn't
      // already chosen one.
      assigned_rep_id: p.assigned_rep_id || s.trunk_rep_user_id || '',
    }))
    setStoreQuery('')
  }

  async function submit() {
    if (!valid || busy) return
    setBusy(true); setErr(null)
    try {
      // Hard block: an assigned rep on a Reserved trunk show can't be
      // booked on another show whose dates overlap the reserved range.
      // (Trunk-show dates have no Save-the-Date soft mode for buyers —
      // each rep can only be in one place.)
      const { data: conflicts } = await supabase.from('trunk_shows')
        .select('id, start_date, end_date')
        .eq('assigned_rep_id', draft.assigned_rep_id)
        .eq('status', 'reserved')
        .lte('start_date', draft.end_date)
        .gte('end_date', draft.start_date)
        .is('deleted_at', null)
      if (conflicts && conflicts.length > 0) {
        const c = conflicts[0]
        const repName = users.find(u => u.id === draft.assigned_rep_id)?.name || 'this rep'
        setErr(`${repName} is already on a Reserved trunk show ${c.start_date}–${c.end_date}. Resolve that first (promote, cancel, or reassign) before creating an overlapping show.`)
        setBusy(false)
        return
      }
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
          <h2 style={{ fontSize: 16, fontWeight: 800, color: isReserved ? '#92400E' : 'var(--ink)' }}>
            {isReserved ? '📌 Save the Date — Reserved Trunk Show' : 'New Trunk Show'}
          </h2>
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
            <DatePicker value={draft.start_date}
              onChange={v => setDraft(p => ({ ...p, start_date: v }))} />
          </div>
          <div className="field">
            <label className="fl">End *</label>
            <DatePicker value={draft.end_date}
              onChange={v => setDraft(p => ({ ...p, end_date: v }))} />
          </div>
        </div>
        <div className="field" style={{ marginBottom: 14 }}>
          <label className="fl">Assigned rep *</label>
          <select value={draft.assigned_rep_id || ''} onChange={e => setDraft(p => ({ ...p, assigned_rep_id: e.target.value }))}>
            <option value="">Pick a rep…</option>
            {repOptions.map(u => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>

        {err && <div style={{ background: '#FEE2E2', color: '#991B1B', padding: '8px 10px', borderRadius: 6, fontSize: 13, marginBottom: 10 }}>{err}</div>}

        {!valid && missing.length > 0 && (
          <div style={{
            background: '#fff8e1', color: '#7a5b00',
            padding: '8px 10px', borderRadius: 6, fontSize: 12, marginBottom: 10,
          }}>
            ⚠ Still need: <strong>{missing.join(', ')}</strong>
            {missing.includes('assigned rep') && repOptions.length === 0 && (
              <div style={{ fontSize: 11, marginTop: 4, opacity: .9 }}>
                The Trunk Rep pool is empty. In Admin Panel, flag a user with the "Trunk Rep" checkbox and they'll appear in the dropdown.
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} className="btn-outline btn-sm">Cancel</button>
          <button onClick={submit} disabled={!valid || busy} className="btn-primary btn-sm">
            {busy ? 'Creating…' : (isReserved ? 'Save the Date' : 'Create')}
          </button>
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--mist)' }}>
          Defaults each show day to 10am–5pm; edit per-day on the detail page.
        </div>
      </div>
    </div>
  )
}

/* ── columns view (kanban by rep) ─────────────────────────── */

function ColumnsView({ shows, usersById, storesById, onOpen }: {
  shows: TrunkShow[]
  usersById: Map<string, any>
  storesById: Map<string, any>
  onOpen: (id: string) => void
}) {
  // Bucket by rep id. Reps with no shows in the filtered set don't
  // get a column; an "(unassigned)" column appears only if some row
  // has no rep.
  const buckets = new Map<string, TrunkShow[]>()
  for (const r of shows) {
    const key = r.assigned_rep_id || '__unassigned__'
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)!.push(r)
  }
  const cols = Array.from(buckets.entries())
    .map(([key, list]) => ({
      key,
      name: key === '__unassigned__'
        ? '(unassigned)'
        : usersById.get(key)?.name || '(unknown rep)',
      list,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8 }}>
      {cols.map(col => (
        <div key={col.key} style={{ minWidth: 240, flex: '0 0 240px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--ink)', padding: '6px 8px', background: 'var(--cream2)', borderRadius: 6 }}>
            {col.name} <span style={{ color: 'var(--mist)', fontWeight: 600 }}>· {col.list.length}</span>
          </div>
          {col.list.map(r => {
            const status = effectiveStatus(r)
            const sc = STATUS_COLOR[status]
            const store = storesById.get(r.store_id)
            return (
              <button key={r.id} onClick={() => onOpen(r.id)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: 10, cursor: 'pointer', fontFamily: 'inherit',
                  background: status === 'reserved' ? '#FFFBEB' : '#fff',
                  border: status === 'reserved' ? '2px dashed #D97706' : '1px solid var(--pearl)',
                  borderRadius: 6,
                  opacity: status === 'cancelled' ? 0.6 : 1,
                }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {store?.name || '(unknown)'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 2 }}>
                  {fmtRange(r.start_date, r.end_date)}
                </div>
                <span style={{ background: sc.bg, color: sc.fg, padding: '1px 6px', borderRadius: 999, fontSize: 9, fontWeight: 800, marginTop: 4, display: 'inline-block', letterSpacing: '.04em' }}>
                  {STATUS_LABEL[status]}
                </span>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/* ── compact list view (spreadsheet-pretty) ──────────────── */

function ListView({ shows, usersById, storesById, onOpen }: {
  shows: TrunkShow[]
  usersById: Map<string, any>
  storesById: Map<string, any>
  onOpen: (id: string) => void
}) {
  return (
    <div style={{ background: '#fff', border: '1px solid var(--pearl)', borderRadius: 8, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: 'var(--cream2)', textAlign: 'left' }}>
            <th style={{ padding: '8px 12px', fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--mist)' }}>Date</th>
            <th style={{ padding: '8px 12px', fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--mist)' }}>Store</th>
            <th style={{ padding: '8px 12px', fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--mist)' }}>City / State</th>
            <th style={{ padding: '8px 12px', fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--mist)' }}>Rep</th>
            <th style={{ padding: '8px 12px', fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--mist)' }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {shows.map(r => {
            const status = effectiveStatus(r)
            const sc = STATUS_COLOR[status]
            const store = storesById.get(r.store_id)
            const rep = r.assigned_rep_id ? usersById.get(r.assigned_rep_id) : null
            return (
              <tr key={r.id}
                onClick={() => onOpen(r.id)}
                style={{
                  cursor: 'pointer',
                  background: status === 'reserved' ? '#FFFBEB' : '#fff',
                  borderTop: '1px solid var(--pearl)',
                  opacity: status === 'cancelled' ? 0.6 : 1,
                }}>
                <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', fontWeight: 600 }}>{fmtRange(r.start_date, r.end_date)}</td>
                <td style={{ padding: '10px 12px', fontWeight: 700, color: 'var(--ink)' }}>{store?.name || '—'}</td>
                <td style={{ padding: '10px 12px', color: 'var(--mist)' }}>{[store?.city, store?.state].filter(Boolean).join(', ') || '—'}</td>
                <td style={{ padding: '10px 12px', color: 'var(--ink)' }}>{rep?.name || '—'}</td>
                <td style={{ padding: '10px 12px' }}>
                  <span style={{ background: sc.bg, color: sc.fg, padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 800, letterSpacing: '.04em' }}>
                    {STATUS_LABEL[status]}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function SubscribeCalendarBanner({ url }: { url: string }) {
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); alert('Copied to clipboard!') }
    catch { window.prompt('Copy this URL:', url) }
  }
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12,
      padding: '10px 14px', borderRadius: 8,
      background: 'rgba(234,88,12,.08)',
      border: '1px solid rgba(234,88,12,.25)',
      color: '#7c2d12', fontSize: 13,
    }}>
      <span style={{ fontSize: 18 }}>📅</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700 }}>Your trunk-show Google Calendar is ready</div>
        <div style={{ fontSize: 12, opacity: .8, marginTop: 2 }}>
          Add it to your phone or laptop to see your assigned shows alongside everything else in your calendar.
        </div>
      </div>
      <a
        href={url} target="_blank" rel="noopener noreferrer"
        className="btn-primary btn-sm"
        style={{ background: '#C2410C', borderColor: '#C2410C', whiteSpace: 'nowrap' }}
      >
        + Add to Google
      </a>
      <button onClick={copy} className="btn-outline btn-sm" style={{ whiteSpace: 'nowrap' }}>
        Copy URL
      </button>
    </div>
  )
}
