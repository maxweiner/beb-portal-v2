'use client'

// Source Attribution Analytics — admin-only dashboard answering
// "where do our customers come from, and which sources bring back
// the most repeat business?"
//
// Three visualizations:
//   1. Distribution — # of customers per source (combined enum +
//      legacy free-text values).
//   2. Avg lifetime appointment count per source — tells you which
//      acquisition channels actually create repeat customers.
//   3. Cohort table — customers per source per year (acquired_at =
//      created_at).
//
// Filterable by store (one or all) and a created_at date range.
// Aggregation runs client-side; for our scale (<50k customers per
// store typically) the round-trip is fine.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Store } from '@/types'
import { HOW_DID_YOU_HEAR_LABELS } from '@/lib/customers/types'

interface CustomerRow {
  how_did_you_hear: string | null
  how_did_you_hear_legacy: string | null
  lifetime_appointment_count: number
  created_at: string
}

interface SourceStat {
  source: string
  label: string
  count: number
  avgAppts: number
}

export default function SourceAttribution({ stores }: { stores: Store[] }) {
  const [storeId, setStoreId] = useState<string>('')  // '' = all stores
  const [sinceDate, setSinceDate] = useState<string>('')
  const [untilDate, setUntilDate] = useState<string>('')
  const [rows, setRows] = useState<CustomerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    let q = supabase.from('customers')
      .select('how_did_you_hear, how_did_you_hear_legacy, lifetime_appointment_count, created_at')
      .is('deleted_at', null)
      .limit(50_000)
    if (storeId) q = q.eq('store_id', storeId)
    if (sinceDate) q = q.gte('created_at', sinceDate)
    if (untilDate) q = q.lte('created_at', untilDate + 'T23:59:59')
    q.then(({ data, error: err }) => {
      if (cancelled) return
      if (err) { setError(err.message); setRows([]) }
      else setRows((data ?? []) as CustomerRow[])
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [storeId, sinceDate, untilDate])

  // Aggregate distribution + avg LTV per source.
  const stats = useMemo<SourceStat[]>(() => {
    if (rows.length === 0) return []
    const buckets = new Map<string, { label: string; count: number; appts: number }>()
    const bump = (key: string, label: string, appts: number) => {
      const b = buckets.get(key) ?? { label, count: 0, appts: 0 }
      b.count++; b.appts += appts
      buckets.set(key, b)
    }
    for (const r of rows) {
      const appts = Number(r.lifetime_appointment_count || 0)
      if (r.how_did_you_hear) {
        const label = HOW_DID_YOU_HEAR_LABELS[r.how_did_you_hear as keyof typeof HOW_DID_YOU_HEAR_LABELS] || r.how_did_you_hear
        bump(`enum:${r.how_did_you_hear}`, label, appts)
      } else if (r.how_did_you_hear_legacy) {
        bump(`legacy:${r.how_did_you_hear_legacy}`, r.how_did_you_hear_legacy, appts)
      } else {
        bump('unknown', '(unknown)', appts)
      }
    }
    return Array.from(buckets.entries())
      .map(([source, b]) => ({
        source, label: b.label,
        count: b.count,
        avgAppts: b.count > 0 ? b.appts / b.count : 0,
      }))
      .sort((a, b) => b.count - a.count)
  }, [rows])

  // Cohort table: rows = year, cols = source (top 8), cells = count.
  const cohorts = useMemo(() => {
    const byYearSource = new Map<number, Map<string, number>>()
    const yearSet = new Set<number>()
    for (const r of rows) {
      const year = new Date(r.created_at).getFullYear()
      yearSet.add(year)
      const sourceLabel = r.how_did_you_hear
        ? (HOW_DID_YOU_HEAR_LABELS[r.how_did_you_hear as keyof typeof HOW_DID_YOU_HEAR_LABELS] || r.how_did_you_hear)
        : (r.how_did_you_hear_legacy || '(unknown)')
      const m = byYearSource.get(year) ?? new Map<string, number>()
      m.set(sourceLabel, (m.get(sourceLabel) ?? 0) + 1)
      byYearSource.set(year, m)
    }
    const years = Array.from(yearSet).sort((a, b) => b - a)
    const topSources = stats.slice(0, 8).map(s => s.label)
    return { years, sources: topSources, byYearSource }
  }, [rows, stats])

  const totalCustomers = rows.length
  const maxCount = Math.max(1, ...stats.map(s => s.count))
  const maxAppts = Math.max(1, ...stats.map(s => s.avgAppts))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Filter bar */}
      <div className="card" style={{ padding: 14, display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr', gap: 12, alignItems: 'end' }}>
        <div className="field" style={{ margin: 0 }}>
          <label className="fl">Store</label>
          <select value={storeId} onChange={e => setStoreId(e.target.value)}>
            <option value="">All stores</option>
            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label className="fl">Acquired since</label>
          <input type="date" value={sinceDate} onChange={e => setSinceDate(e.target.value)} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label className="fl">Acquired until</label>
          <input type="date" value={untilDate} onChange={e => setUntilDate(e.target.value)} />
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
        <div className="card" style={{ padding: 24, color: 'var(--mist)' }}>Aggregating customer data…</div>
      ) : totalCustomers === 0 ? (
        <div className="card" style={{ padding: 24, color: 'var(--mist)', textAlign: 'center' }}>
          No customers match these filters.
        </div>
      ) : (
        <>
          {/* Header summary */}
          <div className="card" style={{
            padding: 14,
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10,
          }}>
            <Stat label="Customers" value={totalCustomers.toLocaleString()} />
            <Stat label="Sources tracked" value={String(stats.length)} />
            <Stat label="Years of data" value={String(cohorts.years.length)} />
          </div>

          {/* 1. Distribution */}
          <div className="card" style={{ padding: 14 }}>
            <div className="card-title">Where customers come from</div>
            <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 12 }}>
              Customer count per source. Structured "How did you hear?" values are merged with imported legacy free-text values; unknown = no source captured.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {stats.map(s => (
                <BarRow key={s.source}
                  label={s.label}
                  value={s.count}
                  max={maxCount}
                  display={`${s.count.toLocaleString()} · ${((s.count / totalCustomers) * 100).toFixed(0)}%`}
                  color="var(--green)" />
              ))}
            </div>
          </div>

          {/* 2. Avg LTV per source */}
          <div className="card" style={{ padding: 14 }}>
            <div className="card-title">Most valuable sources (avg lifetime appointments)</div>
            <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 12 }}>
              Average lifetime appointment count per source. Higher = customers acquired through this channel come back more.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {stats
                .slice()
                .sort((a, b) => b.avgAppts - a.avgAppts)
                .map(s => (
                  <BarRow key={s.source}
                    label={s.label}
                    value={s.avgAppts}
                    max={maxAppts}
                    display={`${s.avgAppts.toFixed(2)} avg · ${s.count.toLocaleString()} cust`}
                    color="var(--green-dark)" />
                ))}
            </div>
          </div>

          {/* 3. Cohort table */}
          <div className="card" style={{ padding: 14 }}>
            <div className="card-title">Cohorts by year × source</div>
            <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 12 }}>
              Customers acquired per year by their top sources. Compare 2024 vs 2025 to see which channels are growing or shrinking.
            </div>
            {cohorts.years.length === 0 ? (
              <div style={{ color: 'var(--mist)', fontSize: 13 }}>(no rows)</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--cream2)' }}>
                      <th style={th}>Year</th>
                      {cohorts.sources.map(s => <th key={s} style={th}>{s}</th>)}
                      <th style={th}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cohorts.years.map(year => {
                      const m = cohorts.byYearSource.get(year) || new Map<string, number>()
                      const yearTotal = Array.from(m.values()).reduce((s, n) => s + n, 0)
                      return (
                        <tr key={year} style={{ borderTop: '1px solid var(--cream2)' }}>
                          <td style={{ ...td, fontWeight: 800 }}>{year}</td>
                          {cohorts.sources.map(s => (
                            <td key={s} style={td}>
                              {m.get(s) ?? <span style={{ color: 'var(--mist)' }}>—</span>}
                            </td>
                          ))}
                          <td style={{ ...td, fontWeight: 800, color: 'var(--green-dark)' }}>{yearTotal}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

const th: React.CSSProperties = {
  padding: '8px 10px', fontSize: 10, fontWeight: 800,
  color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.06em', textAlign: 'left',
}
const td: React.CSSProperties = { padding: '8px 10px', color: 'var(--ink)' }

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)' }}>{value}</div>
    </div>
  )
}

function BarRow({ label, value, max, display, color }: {
  label: string; value: number; max: number; display: string; color: string
}) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
        <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{label}</span>
        <span style={{ color: 'var(--ash)' }}>{display}</span>
      </div>
      <div style={{ background: 'var(--cream2)', borderRadius: 4, height: 10, overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`, height: '100%', background: color,
          borderRadius: 4, transition: 'width .25s ease',
        }} />
      </div>
    </div>
  )
}
