'use client'

// Win-Back tab — auto-segment view for retargeting campaigns.
//
// Three predefined segments (built client-side, not stored):
//   1. Lapsed customers per store (engagement_tier='lapsed')
//   2. Cold customers per store (engagement_tier='cold')
//   3. VIPs not mailed in 6+ months (engagement_tier='vip',
//      daysSinceLastMailing=180)
//
// Plus the user's saved custom segments from the customer_segments
// table. Each segment shows a live count + Export CSV + Customize.
// Customize loads the segment's filters into the Marketing Export
// tab so the operator can tweak before exporting.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Store } from '@/types'
import type { ExportFilters } from '@/lib/customers/exportFilters'

interface SavedSegment {
  id: string
  name: string
  description: string | null
  filters: ExportFilters
  created_at: string
}

interface PredefinedSegment {
  key: string
  name: string
  description: string
  buildFilters: (storeId: string) => ExportFilters
}

const PREDEFINED: PredefinedSegment[] = [
  {
    key: 'lapsed',
    name: 'Lapsed customers',
    description: '12–24 months since last appointment. Worth a nudge before they go cold.',
    buildFilters: storeId => ({ storeId, tiers: ['lapsed'] }),
  },
  {
    key: 'cold',
    name: 'Cold customers',
    description: '24+ months since last appointment OR never had one. Reactivation territory.',
    buildFilters: storeId => ({ storeId, tiers: ['cold'] }),
  },
  {
    key: 'vip-stale',
    name: 'VIPs not mailed in 6+ months',
    description: 'Top customers (VIP tier) who haven\'t received a mailing in 180+ days. Show them you remember them.',
    buildFilters: storeId => ({ storeId, tiers: ['vip'], daysSinceLastMailing: 180 }),
  },
]

export default function WinBack({ stores, storeId, setStoreId, onCustomize }: {
  stores: Store[]
  storeId: string
  setStoreId: (id: string) => void
  /** Switch the parent Customers tab to "Marketing Export" with the
   *  given filters pre-loaded. */
  onCustomize: (filters: ExportFilters) => void
}) {
  const [saved, setSaved] = useState<SavedSegment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function loadSaved() {
    setLoading(true); setError(null)
    const { data, error: err } = await supabase.from('customer_segments')
      .select('*').order('created_at', { ascending: false })
    if (err) setError(err.message)
    else setSaved((data ?? []) as SavedSegment[])
    setLoading(false)
  }
  useEffect(() => { loadSaved() }, [])

  async function deleteSegment(id: string, name: string) {
    if (!confirm(`Delete the saved segment "${name}"?`)) return
    setBusyId(id); setError(null)
    const { error: err } = await supabase.from('customer_segments').delete().eq('id', id)
    setBusyId(null)
    if (err) { setError(err.message); return }
    loadSaved()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Store picker (drives the predefined-segment counts) */}
      <div className="card" style={{ padding: 14, display: 'flex', gap: 12, alignItems: 'end' }}>
        <div className="field" style={{ margin: 0, maxWidth: 360, flex: 1 }}>
          <label className="fl">Store (for predefined segments)</label>
          <select value={storeId} onChange={e => setStoreId(e.target.value)}>
            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div style={{ fontSize: 11, color: 'var(--mist)', flex: 1 }}>
          Saved segments below carry their own store. Each segment&apos;s count auto-loads.
        </div>
      </div>

      {error && (
        <div style={{
          background: 'var(--red-pale)', color: '#7f1d1d',
          border: '1px solid #fecaca', borderRadius: 8,
          padding: '10px 14px', fontSize: 13,
        }}>{error}</div>
      )}

      {/* Predefined segments */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>
          Predefined
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
          {PREDEFINED.map(seg => (
            <SegmentCard key={seg.key}
              name={seg.name}
              description={seg.description}
              filters={seg.buildFilters(storeId)}
              onCustomize={() => onCustomize(seg.buildFilters(storeId))} />
          ))}
        </div>
      </div>

      {/* Saved custom segments */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>
          Your saved segments
        </div>
        {loading ? (
          <div className="card" style={{ padding: 14, color: 'var(--mist)' }}>Loading…</div>
        ) : saved.length === 0 ? (
          <div className="card" style={{ padding: 14, color: 'var(--mist)', fontSize: 13, textAlign: 'center' }}>
            No saved segments yet. Build a filter in <strong>Marketing Export</strong> and click 💾 Save as segment.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
            {saved.map(seg => (
              <SegmentCard key={seg.id}
                name={seg.name}
                description={seg.description || ''}
                filters={seg.filters}
                onCustomize={() => onCustomize(seg.filters)}
                onDelete={() => deleteSegment(seg.id, seg.name)}
                busy={busyId === seg.id} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SegmentCard({ name, description, filters, onCustomize, onDelete, busy }: {
  name: string
  description: string
  filters: ExportFilters
  onCustomize: () => void
  onDelete?: () => void
  busy?: boolean
}) {
  const [count, setCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  // Memoize filters JSON so the effect doesn't re-fire on every parent render.
  const filtersJson = useMemo(() => JSON.stringify(filters), [filters])

  useEffect(() => {
    let cancelled = false
    if (!filters.storeId) { setCount(null); setLoading(false); return }
    setLoading(true); setError(null)
    ;(async () => {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token
      try {
        const res = await fetch('/api/customers/marketing-export/preview', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: filtersJson,
        })
        const json = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) setError(json.error || `Failed (${res.status})`)
        else setCount(json.count ?? 0)
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Network error')
      }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [filtersJson, filters.storeId])

  async function exportNow() {
    if (count == null || count === 0) return
    if (!confirm(`Export ${count} customer${count === 1 ? '' : 's'} as CSV and log the mailing?`)) return
    setExporting(true); setError(null)
    const { data: sess } = await supabase.auth.getSession()
    const token = sess.session?.access_token
    try {
      const res = await fetch('/api/customers/marketing-export/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ ...filters, mailingType: 'postcard' }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j.error || `Export failed (${res.status})`)
        setExporting(false); return
      }
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${name.toLowerCase().replace(/\W+/g, '-')}-${new Date().toISOString().slice(0,10)}.csv`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    } catch (e: any) {
      setError(e?.message || 'Network error')
    }
    setExporting(false)
  }

  return (
    <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink)' }}>{name}</div>
        {description && (
          <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 4, lineHeight: 1.4 }}>
            {description}
          </div>
        )}
      </div>

      <div style={{
        background: 'var(--cream2)', borderRadius: 6, padding: '8px 12px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
          Match count
        </span>
        <span style={{ fontSize: 22, fontWeight: 900, color: count === 0 ? 'var(--mist)' : 'var(--green-dark)' }}>
          {loading ? '…' : (count ?? '—')}
        </span>
      </div>

      {error && (
        <div style={{ fontSize: 11, color: '#7f1d1d' }}>{error}</div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button className="btn-primary btn-sm" onClick={exportNow}
          disabled={exporting || loading || count == null || count === 0}>
          {exporting ? 'Exporting…' : '⬇️ Export CSV'}
        </button>
        <button className="btn-outline btn-sm" onClick={onCustomize}>Customize</button>
        {onDelete && (
          <button className="btn-outline btn-sm" disabled={busy} onClick={onDelete}
            style={{ marginLeft: 'auto', color: 'var(--red)' }}>
            Delete
          </button>
        )}
      </div>
    </div>
  )
}
