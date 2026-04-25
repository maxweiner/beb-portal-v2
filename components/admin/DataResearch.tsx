'use client'

// Data Research — admin view of QR-code performance per store/event.
// Filters: Store (single-select, required) + Event (single + "All events")
// + Active campaigns / All / Past / Upcoming. Table sortable. Inline-edit
// "Total sent" autosaves to /api/data-research/total-sent.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'

type EventScope = 'active' | 'all' | 'past' | 'upcoming'
const CAMPAIGN_WINDOW_DAYS = 28

interface Row {
  qr_code_id: string
  code: string
  type: string
  source: string | null
  label: string
  created_at: string
  total_sent: number
  scans: number
  unique_scans: number
  appointments: number
  conversion_pct: number | null
}

interface Totals {
  scans: number
  unique_scans: number
  appointments: number
  total_sent: number
  conversion_pct: number | null
}

type SortKey = keyof Row | 'created_at'

function fmtDate(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? 'T12:00:00' : ''))
  const w = d.toLocaleDateString('en-US', { weekday: 'short' })
  const month = d.toLocaleDateString('en-US', { month: 'short' })
  const day = d.getDate()
  const ord = (n: number) => { const v = n % 100; if (v >= 11 && v <= 13) return `${n}th`; switch (n % 10) { case 1: return `${n}st'`; case 2: return `${n}nd`; case 3: return `${n}rd` } return `${n}th` }
  const wmap: Record<string, string> = { Tue: 'Tues', Thu: 'Thurs' }
  return `${wmap[w] || w} ${month} ${ord(day)}`
}

function pctColor(pct: number | null, totalSent: number): string {
  if (pct === null || totalSent === 0) return 'var(--mist)'
  if (pct >= 2) return 'var(--green-dark)'
  if (pct >= 1) return '#92400E'
  return '#991B1B'
}

function pctBg(pct: number | null, totalSent: number): string {
  if (pct === null || totalSent === 0) return 'transparent'
  if (pct >= 2) return 'var(--green-pale)'
  if (pct >= 1) return '#FEF3C7'
  return '#FEE2E2'
}

export default function DataResearch() {
  const { user, stores, events, brand } = useApp()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'

  const brandStores = useMemo(() => stores.filter((s: any) => s.brand === brand), [stores, brand])
  const [storeId, setStoreId] = useState<string>('')
  useEffect(() => { if (!storeId && brandStores.length) setStoreId(brandStores[0].id) }, [brandStores, storeId])

  const [scope, setScope] = useState<EventScope>('active')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const todayMs = today.getTime()

  const eventsForStore = useMemo(() => {
    return events
      .filter((e: any) => e.store_id === storeId)
      .filter((e: any) => {
        const startMs = new Date(e.start_date + 'T12:00:00').getTime()
        const inFuture = startMs >= todayMs
        const inPast = startMs < todayMs
        const inActiveWindow =
          startMs - CAMPAIGN_WINDOW_DAYS * 86400000 <= todayMs &&
          startMs + 4 * 86400000 >= todayMs
        if (scope === 'active') return inActiveWindow
        if (scope === 'past') return inPast
        if (scope === 'upcoming') return inFuture
        return true
      })
      .sort((a: any, b: any) => b.start_date.localeCompare(a.start_date))
  }, [events, storeId, scope, todayMs])

  const [eventId, setEventId] = useState<string>('')  // '' = all events
  useEffect(() => { setEventId('') /* reset when store/scope changes */ }, [storeId, scope])

  const [rows, setRows] = useState<Row[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [loading, setLoading] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('scans')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const refetch = async () => {
    if (!storeId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ store_id: storeId })
      if (eventId) params.set('event_id', eventId)
      const res = await fetch(`/api/data-research?${params}`)
      const json = await res.json()
      if (res.ok) {
        setRows(json.rows || [])
        setTotals(json.totals || null)
        setLastRefresh(new Date())
      } else {
        alert('Failed to load: ' + (json.error || res.status))
      }
    } catch (e: any) {
      alert('Network error: ' + e?.message)
    }
    setLoading(false)
  }
  useEffect(() => { refetch() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [storeId, eventId])

  const sortedRows = useMemo(() => {
    const copy = [...rows]
    copy.sort((a, b) => {
      const av = (a as any)[sortKey]
      const bv = (b as any)[sortKey]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'desc' ? bv - av : av - bv
      return sortDir === 'desc' ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv))
    })
    return copy
  }, [rows, sortKey, sortDir])

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(k); setSortDir('desc') }
  }

  async function saveTotalSent(qr_code_id: string, value: number) {
    if (!eventId) return  // only meaningful when an event is selected
    const res = await fetch('/api/data-research/total-sent', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qr_code_id, event_id: eventId, total_sent: value }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      alert('Save failed: ' + (j.error || res.status))
      return
    }
    // Optimistic local update
    setRows(prev => prev.map(r => r.qr_code_id === qr_code_id
      ? { ...r, total_sent: value, conversion_pct: value > 0 ? (r.appointments / value) * 100 : null }
      : r))
  }

  if (!isAdmin) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="card text-center" style={{ padding: 40 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
          <div className="font-bold" style={{ color: 'var(--ink)' }}>Admin only</div>
        </div>
      </div>
    )
  }

  if (brandStores.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-black" style={{ color: 'var(--ink)' }}>Data Research</h1>
        <p style={{ color: 'var(--mist)', marginTop: 6 }}>No stores in this brand yet.</p>
      </div>
    )
  }

  const headers: { key: SortKey; label: string; align?: 'right' | 'left' }[] = [
    { key: 'label', label: 'QR' },
    { key: 'type', label: 'Type' },
    { key: 'source', label: 'Source' },
    { key: 'scans', label: 'Scans', align: 'right' },
    { key: 'unique_scans', label: 'Unique', align: 'right' },
    { key: 'appointments', label: 'Appts', align: 'right' },
    { key: 'total_sent', label: 'Total sent', align: 'right' },
    { key: 'conversion_pct', label: 'Conversion', align: 'right' },
    { key: 'created_at', label: 'Created' },
  ]

  return (
    <div className="p-6" style={{ maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <h1 className="text-2xl font-black" style={{ color: 'var(--ink)' }}>Data Research</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {lastRefresh && (
            <span style={{ fontSize: 12, color: 'var(--mist)' }}>
              Updated {lastRefresh.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
          <button onClick={refetch} disabled={loading} className="btn-outline btn-sm">
            {loading ? '…' : '⟳ Refresh'}
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="card" style={{ marginBottom: 14, padding: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) minmax(220px, 1.4fr) auto', gap: 10, alignItems: 'end' }}>
          <div>
            <label className="fl">Store</label>
            <select value={storeId} onChange={e => setStoreId(e.target.value)} style={{ width: '100%' }}>
              {brandStores.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="fl">Event</label>
            <select value={eventId} onChange={e => setEventId(e.target.value)} style={{ width: '100%' }}>
              <option value="">All events ({eventsForStore.length})</option>
              {eventsForStore.map((e: any) => (
                <option key={e.id} value={e.id}>{fmtDate(e.start_date)}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['active', 'all', 'upcoming', 'past'] as const).map(s => {
              const sel = scope === s
              return (
                <button key={s} onClick={() => setScope(s)} style={{
                  padding: '6px 10px', borderRadius: 6, border: '1px solid var(--pearl)',
                  background: sel ? 'var(--green-pale)' : 'white',
                  color: sel ? 'var(--green-dark)' : 'var(--mist)',
                  fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  textTransform: 'capitalize', fontFamily: 'inherit',
                }}>{s}</button>
              )
            })}
          </div>
        </div>
        {!eventId && (
          <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 8 }}>
            Showing lifetime totals across {eventsForStore.length} event{eventsForStore.length === 1 ? '' : 's'}.
            Pick a single event to inline-edit Total sent.
          </div>
        )}
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--cream2)', borderBottom: '2px solid var(--pearl)' }}>
                {headers.map(h => (
                  <th key={h.key as string}
                    onClick={() => toggleSort(h.key)}
                    style={{
                      padding: '10px 12px', textAlign: h.align || 'left',
                      fontSize: 11, fontWeight: 800, color: 'var(--ash)',
                      textTransform: 'uppercase', letterSpacing: '.04em',
                      cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
                    }}>
                    {h.label}
                    {sortKey === h.key && <span style={{ marginLeft: 4, fontSize: 9 }}>{sortDir === 'desc' ? '▼' : '▲'}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.length === 0 ? (
                <tr><td colSpan={headers.length} style={{ padding: 30, textAlign: 'center', color: 'var(--mist)' }}>
                  {loading ? 'Loading…' : 'No QRs for this store yet.'}
                </td></tr>
              ) : sortedRows.map(r => (
                <tr key={r.qr_code_id} style={{ borderBottom: '1px solid var(--cream2)' }}>
                  <td style={{ padding: '8px 12px' }}>
                    <div style={{ fontWeight: 700, color: 'var(--ink)' }}>{r.label}</div>
                    <code style={{ fontSize: 10, color: 'var(--mist)' }}>{r.code}</code>
                  </td>
                  <td style={{ padding: '8px 12px', color: 'var(--mist)', textTransform: 'capitalize' }}>{r.type}</td>
                  <td style={{ padding: '8px 12px' }}>{r.source || <span style={{ color: 'var(--mist)' }}>—</span>}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700 }}>{r.scans}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--mist)' }}>{r.unique_scans}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: 'var(--green-dark)' }}>{r.appointments}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                    {eventId ? (
                      <input type="number" min={0}
                        defaultValue={r.total_sent}
                        onBlur={e => {
                          const v = Math.max(0, Math.floor(Number(e.target.value) || 0))
                          if (v !== r.total_sent) saveTotalSent(r.qr_code_id, v)
                        }}
                        style={{ width: 90, padding: '4px 6px', textAlign: 'right', fontSize: 13 }}
                      />
                    ) : (
                      <span style={{ color: 'var(--mist)' }}>{r.total_sent || '—'}</span>
                    )}
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                    {r.conversion_pct === null ? (
                      <span style={{ color: 'var(--mist)' }}>—</span>
                    ) : (
                      <span style={{
                        display: 'inline-block', padding: '2px 8px', borderRadius: 6,
                        background: pctBg(r.conversion_pct, r.total_sent),
                        color: pctColor(r.conversion_pct, r.total_sent),
                        fontWeight: 800, fontSize: 12,
                      }}>{r.conversion_pct.toFixed(1)}%</span>
                    )}
                  </td>
                  <td style={{ padding: '8px 12px', color: 'var(--mist)', whiteSpace: 'nowrap' }}>{fmtDate(r.created_at.slice(0, 10))}</td>
                </tr>
              ))}
            </tbody>
            {totals && sortedRows.length > 0 && (
              <tfoot>
                <tr style={{ background: 'var(--cream)', borderTop: '2px solid var(--pearl)', fontWeight: 800 }}>
                  <td colSpan={3} style={{ padding: '10px 12px', color: 'var(--ink)' }}>Totals</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>{totals.scans}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--mist)' }}>{totals.unique_scans}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--green-dark)' }}>{totals.appointments}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>{totals.total_sent || '—'}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    {totals.conversion_pct === null ? (
                      <span style={{ color: 'var(--mist)' }}>—</span>
                    ) : (
                      <span style={{
                        display: 'inline-block', padding: '2px 8px', borderRadius: 6,
                        background: pctBg(totals.conversion_pct, totals.total_sent),
                        color: pctColor(totals.conversion_pct, totals.total_sent),
                      }}>{totals.conversion_pct.toFixed(1)}%</span>
                    )}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  )
}
