'use client'

// v1 runner for a saved custom_report. Loads the row, runs its config
// against the active brand, and renders a sortable + paginated table
// with a CSV download. Truncation banner at the 10k cap; cancel button
// after 5s of running; 30s server-side timeout (handled in runQuery).

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import { allColumns, type ReportConfig, type ColumnDef } from '@/lib/reports/schema'
import { runReport, displayKey, getValue, type RunResult } from '@/lib/reports/runQuery'
import { deriveOutputColumns, buildCsv } from '@/lib/reports/output'
import EmailNowModal from './EmailNowModal'

const PAGE_SIZE = 100

interface ReportRow {
  id: string
  name: string
  source: string
  config: ReportConfig
  visibility: string
  store_id: string | null
  last_run_at: string | null
}

export default function CustomReportRunner({ reportId, onBack, onEdit }: {
  reportId: string
  onBack: () => void
  onEdit: () => void
}) {
  const { brand } = useApp()
  const [report, setReport] = useState<ReportRow | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [running, setRunning] = useState(false)
  const [showCancel, setShowCancel] = useState(false)
  const [result, setResult] = useState<RunResult | null>(null)
  const [page, setPage] = useState(0)
  const [clientSort, setClientSort] = useState<{ field: string; dir: 'asc' | 'desc' } | null>(null)
  const [emailOpen, setEmailOpen] = useState(false)
  const [xlsxBusy, setXlsxBusy] = useState(false)

  // Load report row
  useEffect(() => {
    supabase.from('custom_reports').select('*').eq('id', reportId).maybeSingle()
      .then(({ data }) => {
        setReport((data as ReportRow | null) ?? null)
        setLoaded(true)
      })
  }, [reportId])

  // Auto-run when report loads
  useEffect(() => {
    if (report) run(report)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?.id])

  async function run(r: ReportRow) {
    setRunning(true); setShowCancel(false); setPage(0); setClientSort(null)
    const cancelTimer = setTimeout(() => setShowCancel(true), 5000)
    const res = await runReport(r.source, r.config, brand)
    clearTimeout(cancelTimer)
    setRunning(false); setShowCancel(false)
    setResult(res)
    if (!res.error) {
      void supabase.from('custom_reports')
        .update({ last_run_at: new Date().toISOString() })
        .eq('id', r.id)
    }
  }

  const colCatalog = useMemo(() => report ? allColumns(report.source) : [], [report?.source])
  const colDefByKey = useMemo(() => {
    const m = new Map<string, ColumnDef>()
    colCatalog.forEach(c => m.set(c.column.key, c.column))
    return m
  }, [colCatalog])

  // Output columns + headers. Derived from source + config — handles both
  // grouped (groupBy + aggregates) and ungrouped (raw columns) modes.
  const isGrouped = !!report && (report.config.groupBy?.length ?? 0) > 0
  const outputColumns = useMemo(
    () => (report ? deriveOutputColumns(report.source, report.config) : []),
    [report],
  )

  const sortedRows = useMemo(() => {
    if (!result) return []
    if (!clientSort) return result.rows
    return [...result.rows].sort((a, b) => {
      // In grouped mode, output rows have the column keys as own properties
      // (including __agg_N keys). In ungrouped mode, joined keys still need
      // getValue() to reach into embedded objects.
      const av = isGrouped ? a[clientSort.field] : getValue(a, clientSort.field)
      const bv = isGrouped ? b[clientSort.field] : getValue(b, clientSort.field)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') {
        return clientSort.dir === 'asc' ? av - bv : bv - av
      }
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true })
      return clientSort.dir === 'asc' ? cmp : -cmp
    })
  }, [result, clientSort, isGrouped])

  const pageRows = sortedRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE))

  function fmtCell(v: any, type?: string): string {
    if (v == null) return ''
    if (type === 'datetime' || type === 'date') {
      try {
        const d = new Date(v)
        if (!Number.isNaN(d.getTime())) {
          return type === 'date'
            ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        }
      } catch { /* fall through */ }
    }
    if (typeof v === 'number' && type === 'number') {
      // Up to 2 fractional digits; thousand separators. Integers stay integer.
      return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 })
    }
    if (Array.isArray(v)) return v.join(', ')
    if (typeof v === 'object') return JSON.stringify(v)
    return String(v)
  }

  // Server-side XLSX render so the ~1MB exceljs dependency stays out of
  // the browser bundle. Re-runs the report under the user's auth — same
  // path as the email export — and streams the file as a download.
  async function downloadXlsx() {
    if (!report || !result) return
    setXlsxBusy(true)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess?.session?.access_token
      if (!token) throw new Error('Not signed in')
      const res = await fetch(`/api/reports/${report.id}/export?format=xlsx&brand=${brand}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error || `HTTP ${res.status}`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${report.name.replace(/[^a-z0-9-_]+/gi, '_')}_${new Date().toISOString().slice(0,10)}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e: any) {
      alert(`Excel export failed: ${e?.message || 'unknown error'}`)
    }
    setXlsxBusy(false)
  }

  function downloadCsv() {
    if (!report || !result) return
    const csv = buildCsv(report.source, report.config, sortedRows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${report.name.replace(/[^a-z0-9-_]+/gi, '_')}_${new Date().toISOString().slice(0,10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  if (!loaded) return <div className="p-6"><p style={{ color: 'var(--mist)' }}>Loading…</p></div>
  if (!report) return (
    <div className="p-6">
      <button onClick={onBack} className="btn-outline btn-sm">← Back to Reports</button>
      <p style={{ color: 'var(--mist)', marginTop: 12 }}>Report not found.</p>
    </div>
  )

  return (
    <div className="p-6" style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, marginBottom: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--green-dark)', fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: '4px 0' }}>
            ← Back to Reports
          </button>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)', margin: '4px 0 2px' }}>{report.name}</h1>
          <div style={{ fontSize: 12, color: 'var(--mist)' }}>
            {report.source} · brand {brand}
            {isGrouped && <> · grouped by {(report.config.groupBy ?? []).map(k => colDefByKey.get(k)?.label || displayKey(k)).join(' + ')}</>}
            {' · '}
            {result ? `${result.rows.length} row${result.rows.length === 1 ? '' : 's'} in ${result.durationMs}ms` : '—'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => report && run(report)} disabled={running} className="btn-outline btn-sm">⟳ Re-run</button>
          <button onClick={downloadCsv} disabled={!result || result.rows.length === 0} className="btn-outline btn-sm">⤓ CSV</button>
          <button onClick={downloadXlsx} disabled={xlsxBusy || !result || result.rows.length === 0} className="btn-outline btn-sm">
            {xlsxBusy ? '…' : '⤓ Excel'}
          </button>
          <button onClick={() => setEmailOpen(true)} disabled={!result || result.rows.length === 0} className="btn-outline btn-sm">✉ Email</button>
          <button onClick={onEdit} className="btn-outline btn-sm">Edit</button>
        </div>
      </div>

      {/* Running state */}
      {running && (
        <div className="card" style={{ textAlign: 'center', padding: 30 }}>
          <div style={{ fontSize: 13, color: 'var(--mist)' }}>Running report…</div>
          {showCancel && (
            <button onClick={() => { setRunning(false); setShowCancel(false) }} className="btn-outline btn-sm" style={{ marginTop: 12 }}>
              Cancel
            </button>
          )}
        </div>
      )}

      {/* Error */}
      {!running && result?.error && (
        <div className="card" style={{ padding: 18, borderLeft: '4px solid #B91C1C', background: '#FEF2F2' }}>
          <div style={{ fontWeight: 800, color: '#991B1B' }}>Report failed</div>
          <div style={{ fontSize: 13, color: '#7F1D1D', marginTop: 4 }}>{result.error}</div>
        </div>
      )}

      {/* Truncation banner */}
      {!running && result?.truncated && (
        <div className="card" style={{ padding: 12, borderLeft: '4px solid #92400E', background: '#FEF3C7', marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: '#92400E', fontWeight: 700 }}>
            Results truncated at 10,000 rows. Add filters to narrow down.
          </span>
        </div>
      )}

      {/* Results table */}
      {!running && result && !result.error && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {result.rows.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: 'var(--mist)' }}>No rows match this report.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--cream2)', borderBottom: '2px solid var(--pearl)' }}>
                    {outputColumns.map(c => {
                      const sel = clientSort?.field === c.key
                      return (
                        <th key={c.key}
                          onClick={() => setClientSort(s => s?.field === c.key ? { field: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { field: c.key, dir: 'asc' })}
                          style={{
                            padding: '10px 12px', textAlign: 'left',
                            fontSize: 11, fontWeight: 800, color: 'var(--ash)',
                            textTransform: 'uppercase', letterSpacing: '.04em',
                            cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
                          }}>
                          {c.label}
                          {sel && <span style={{ marginLeft: 4, fontSize: 9 }}>{clientSort?.dir === 'asc' ? '▲' : '▼'}</span>}
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--cream2)' }}>
                      {outputColumns.map(c => {
                        const v = isGrouped ? row[c.key] : getValue(row, c.key)
                        return (
                          <td key={c.key} style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: 'var(--ink)' }}>
                            {fmtCell(v, c.type)}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderTop: '1px solid var(--cream2)' }}>
              <div style={{ fontSize: 12, color: 'var(--mist)' }}>
                Page {page + 1} of {totalPages} · showing {pageRows.length} of {sortedRows.length}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="btn-outline btn-sm">‹ Prev</button>
                <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="btn-outline btn-sm">Next ›</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Email Now modal */}
      {report && (
        <EmailNowModal
          open={emailOpen}
          onClose={() => setEmailOpen(false)}
          reportId={report.id}
          reportName={report.name}
          rowCount={result?.rows.length ?? 0}
        />
      )}
    </div>
  )
}
