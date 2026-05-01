'use client'

// Lookalike Export — find more customers like your best ones.
//
// V1 per spec: same store, top-10 zip codes from the source segment,
// excluding the source customers themselves + DNC + soft-deleted.
//
// Source segment is picked from the 3 predefined Win-Back segments
// (VIPs / Lapsed / Cold) OR any saved customer_segments row.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Store } from '@/types'
import type { ExportFilters } from '@/lib/customers/exportFilters'

interface SavedSegment {
  id: string
  name: string
  filters: ExportFilters
}

interface PredefinedOption {
  key: string
  label: string
  buildFilters: (storeId: string) => ExportFilters
}

const PREDEFINED: PredefinedOption[] = [
  { key: 'vip',    label: 'VIPs',    buildFilters: storeId => ({ storeId, tiers: ['vip'] }) },
  { key: 'lapsed', label: 'Lapsed',  buildFilters: storeId => ({ storeId, tiers: ['lapsed'] }) },
  { key: 'cold',   label: 'Cold',    buildFilters: storeId => ({ storeId, tiers: ['cold'] }) },
]

interface LookalikeResp {
  signature: {
    sourceCount: number
    topZips: { zip: string; count: number }[]
    topSources: { label: string; count: number }[]
    avgLifetimeAppts: number
  }
  lookalikeCount: number
}

export default function Lookalike({ stores, storeId, setStoreId }: {
  stores: Store[]
  storeId: string
  setStoreId: (id: string) => void
}) {
  const [saved, setSaved] = useState<SavedSegment[]>([])
  // Source picker: either 'pre:<key>' or 'saved:<id>'
  const [pick, setPick] = useState<string>('pre:vip')
  const [resp, setResp] = useState<LookalikeResp | null>(null)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase.from('customer_segments').select('id, name, filters').order('name')
      .then(({ data }) => { if (!cancelled) setSaved((data ?? []) as SavedSegment[]) })
    return () => { cancelled = true }
  }, [])

  // Resolve the chosen source's filters.
  const sourceFilters = useMemo<ExportFilters | null>(() => {
    if (!storeId) return null
    if (pick.startsWith('pre:')) {
      const key = pick.slice(4)
      const opt = PREDEFINED.find(p => p.key === key)
      return opt ? opt.buildFilters(storeId) : null
    }
    if (pick.startsWith('saved:')) {
      const id = pick.slice(6)
      const seg = saved.find(s => s.id === id)
      return seg?.filters ?? null
    }
    return null
  }, [pick, storeId, saved])

  // Auto-fetch lookalike preview whenever the source changes (debounced).
  useEffect(() => {
    if (!sourceFilters?.storeId) { setResp(null); return }
    let cancelled = false
    setLoading(true); setError(null)
    ;(async () => {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token
      try {
        const res = await fetch('/api/customers/lookalike/preview', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(sourceFilters),
        })
        const json = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) setError(json.error || `Failed (${res.status})`)
        else setResp(json as LookalikeResp)
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Network error')
      }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [sourceFilters])

  async function exportNow() {
    if (!sourceFilters || !resp || resp.lookalikeCount === 0) return
    if (!confirm(`Export ${resp.lookalikeCount} lookalike candidate${resp.lookalikeCount === 1 ? '' : 's'} as CSV and log the mailing?`)) return
    setExporting(true); setError(null)
    const { data: sess } = await supabase.auth.getSession()
    const token = sess.session?.access_token
    try {
      const res = await fetch('/api/customers/lookalike/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ ...sourceFilters, mailingType: 'postcard' }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j.error || `Export failed (${res.status})`)
        setExporting(false); return
      }
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `lookalike-export-${new Date().toISOString().slice(0,10)}.csv`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    } catch (e: any) {
      setError(e?.message || 'Network error')
    }
    setExporting(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card" style={{ padding: 14 }}>
        <div className="card-title">👯 Lookalike Export</div>
        <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 14, lineHeight: 1.5 }}>
          Pick a source segment (your best customers), and we&apos;ll find more customers <strong>at the same store</strong> who share their profile signature — top 10 zip codes from the source — but aren&apos;t in the source segment.
          Useful for test mailings to find more customers like your VIPs.
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'end' }}>
          <div className="field" style={{ margin: 0 }}>
            <label className="fl">Store</label>
            <select value={storeId} onChange={e => setStoreId(e.target.value)}>
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="fl">Source segment (your best customers)</label>
            <select value={pick} onChange={e => setPick(e.target.value)}>
              <optgroup label="Predefined">
                {PREDEFINED.map(p => (
                  <option key={'pre:' + p.key} value={'pre:' + p.key}>{p.label}</option>
                ))}
              </optgroup>
              {saved.length > 0 && (
                <optgroup label="Your saved segments">
                  {saved.map(s => (
                    <option key={'saved:' + s.id} value={'saved:' + s.id}>{s.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
        </div>
      </div>

      {error && (
        <div style={{
          background: 'var(--red-pale)', color: '#7f1d1d',
          border: '1px solid #fecaca', borderRadius: 8,
          padding: '10px 14px', fontSize: 13,
        }}>{error}</div>
      )}

      {loading ? (
        <div className="card" style={{ padding: 24, color: 'var(--mist)' }}>Computing lookalike profile…</div>
      ) : !resp ? null : resp.signature.sourceCount === 0 ? (
        <div className="card" style={{ padding: 24, color: 'var(--mist)', textAlign: 'center' }}>
          The source segment is empty for this store. Pick a different segment or store.
        </div>
      ) : (
        <>
          {/* Signature panel */}
          <div className="card" style={{ padding: 14 }}>
            <div className="card-title">Profile signature</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Source customers</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)' }}>{resp.signature.sourceCount}</div>
                <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 4 }}>
                  Avg lifetime appts: <strong style={{ color: 'var(--ink)' }}>{resp.signature.avgLifetimeAppts.toFixed(2)}</strong>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Top zips driving the lookalike match</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                  {resp.signature.topZips.map(z => (
                    <span key={z.zip} style={{
                      fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 99,
                      background: 'var(--green-pale)', color: 'var(--green-dark)',
                    }}>{z.zip} <span style={{ color: 'var(--mist)' }}>({z.count})</span></span>
                  ))}
                </div>
                {resp.signature.topSources.length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 8 }}>
                    Common sources: {resp.signature.topSources.slice(0, 3).map(s => s.label).join(', ')}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Result + export */}
          <div className="card" style={{
            padding: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
          }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                Lookalike candidates
              </div>
              <div style={{ fontSize: 28, fontWeight: 900, color: resp.lookalikeCount === 0 ? 'var(--mist)' : 'var(--green-dark)' }}>
                {resp.lookalikeCount}
              </div>
              <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 4 }}>
                Same store · zip in top 10 · excluding the source segment + DNC + deleted
              </div>
            </div>
            <button className="btn-primary btn-sm" onClick={exportNow}
              disabled={exporting || resp.lookalikeCount === 0}>
              {exporting ? 'Exporting…' : '⬇️ Export CSV'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
