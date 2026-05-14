'use client'

// Wells Fargo cleared-check reconciliation. Imports a WF activity
// CSV, isolates check rows, runs the matcher, and surfaces five
// finding categories (matched / amount mismatch / duplicate clearing
// / orphan cleared / outstanding) with status workflow.
//
// Brand-scoped: uses the active brand from useApp(); each brand has
// its own bank account and findings.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import Checkbox from '@/components/ui/Checkbox'
import type { NavPage } from '@/app/page'

const withTimeout = <T,>(promise: PromiseLike<T>, ms = 15000): Promise<T> => {
  return Promise.race([
    Promise.resolve(promise) as Promise<T>,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Request timed out')), ms),
    ),
  ])
}

type FindingType = 'matched' | 'amount_mismatch' | 'duplicate_clearing' | 'orphan_cleared' | 'outstanding' | 'voided_cashed'
type FindingStatus = 'open' | 'disputed' | 'resolved' | 'ignored'

interface Finding {
  id: string
  brand: string
  check_number: string
  finding_type: FindingType
  status: FindingStatus
  written_amount: number | null
  cleared_amount_total: number | null
  cleared_count: number
  amount_delta: number | null
  written_date: string | null
  cleared_dates: string[] | null
  payee_label: string | null
  event_id: string | null
  event_label: string | null
  note: string | null
  resolved_by: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
  last_matched_at: string
}

interface ClearedCheck {
  id: string
  brand: string
  check_number: string
  cleared_date: string
  cleared_amount: number
  description: string
  status: string | null
  created_at: string
}

interface ImportRow {
  id: string
  filename: string
  uploaded_by: string
  uploaded_at: string
  row_count: number
  imported_count: number
  skipped_count: number
  duplicate_count: number
}

const TYPE_LABEL: Record<FindingType, string> = {
  matched: 'Matched',
  amount_mismatch: 'Amount mismatch',
  duplicate_clearing: 'Duplicate clearing',
  orphan_cleared: 'Orphan cleared',
  outstanding: 'Outstanding',
  voided_cashed: 'VOIDED CHECK CASHED',
}
const TYPE_ICON: Record<FindingType, string> = {
  matched: '✅',
  amount_mismatch: '⚠️',
  duplicate_clearing: '🚨',
  orphan_cleared: '❓',
  outstanding: '📭',
  voided_cashed: '🚨',
}
const TYPE_COLOR: Record<FindingType, { bg: string; fg: string }> = {
  matched:            { bg: '#D1FAE5', fg: '#065F46' },
  amount_mismatch:    { bg: '#FEF3C7', fg: '#92400E' },
  duplicate_clearing: { bg: '#FEE2E2', fg: '#991B1B' },
  orphan_cleared:     { bg: '#E0E7FF', fg: '#3730A3' },
  outstanding:        { bg: '#F5F5F4', fg: '#78716C' },
  voided_cashed:      { bg: '#7F1D1D', fg: '#FFFFFF' }, // ALARM — inverted reds
}
const STATUS_LABEL: Record<FindingStatus, string> = {
  open: 'Open', disputed: 'Disputed', resolved: 'Resolved', ignored: 'Ignored',
}
const STATUS_COLOR: Record<FindingStatus, { bg: string; fg: string }> = {
  open:     { bg: '#FEF3C7', fg: '#92400E' },
  disputed: { bg: '#FEE2E2', fg: '#991B1B' },
  resolved: { bg: '#D1FAE5', fg: '#065F46' },
  ignored:  { bg: '#E5E7EB', fg: '#374151' },
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '—'
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso.length <= 10 ? iso + 'T12:00:00' : iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0
  const d = new Date(iso.length <= 10 ? iso + 'T12:00:00' : iso)
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000))
}

export default function ReconciliationPage({ setNav }: { setNav?: (n: NavPage) => void } = {}) {
  const { user, brand } = useApp()
  const isAllowed = user?.role === 'accounting' || user?.role === 'admin' || user?.role === 'superadmin' || user?.is_partner === true

  // null = loading; [] = loaded but empty; non-empty = data
  const [findings, setFindings] = useState<Finding[] | null>(null)
  const [lastImport, setLastImport] = useState<ImportRow | null | 'loading'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'findings' | 'outstanding'>('findings')
  const [typeFilter, setTypeFilter] = useState<'all' | FindingType>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | FindingStatus>('open')
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [matchError, setMatchError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  const reloadRef = useRef<() => Promise<void>>(async () => {})
  reloadRef.current = async () => {
    if (!brand) return
    setError(null)
    try {
      const [findingsRes, importRes] = await Promise.all([
        withTimeout(
          supabase.from('reconciliation_findings').select('*').eq('brand', brand)
            .order('updated_at', { ascending: false }),
        ),
        withTimeout(
          supabase.from('cleared_check_imports').select('*').eq('brand', brand)
            .order('uploaded_at', { ascending: false }).limit(1),
        ),
      ])
      setFindings((findingsRes.data || []) as Finding[])
      setLastImport((importRes.data?.[0] as ImportRow) || null)
    } catch (e: any) {
      setError(e?.message || 'Failed to load')
      setFindings([])
      setLastImport(null)
    }
  }

  useEffect(() => { void reloadRef.current() }, [brand])

  const counts = useMemo(() => {
    // Tiles show what needs attention — open findings only. Resolved /
    // disputed / ignored stay in the DB (so a future re-clearing of a
    // resolved orphan still fires as a new duplicate_clearing finding)
    // but they don't pad the working count.
    const by: Record<FindingType, number> = {
      matched: 0, amount_mismatch: 0, duplicate_clearing: 0, orphan_cleared: 0, outstanding: 0, voided_cashed: 0,
    }
    for (const f of findings || []) {
      if (f.status !== 'open') continue
      by[f.finding_type] = (by[f.finding_type] || 0) + 1
    }
    return by
  }, [findings])

  const filtered = useMemo(() => {
    if (!findings) return []
    const q = search.trim().toLowerCase()
    return findings.filter(f => {
      if (tab === 'outstanding' && f.finding_type !== 'outstanding') return false
      if (tab === 'findings' && f.finding_type === 'outstanding') return false
      // Matched findings clutter the working view — only show when the
      // user explicitly picks the Matched chip.
      if (tab === 'findings' && f.finding_type === 'matched' && typeFilter !== 'matched') return false
      if (typeFilter !== 'all' && f.finding_type !== typeFilter) return false
      if (statusFilter !== 'all' && f.status !== statusFilter) return false
      if (q) {
        const blob = [f.check_number, f.payee_label, f.event_label, f.note].filter(Boolean).join(' ').toLowerCase()
        if (!blob.includes(q)) return false
      }
      return true
    })
  }, [findings, tab, typeFilter, statusFilter, search])

  async function reRunMatch() {
    if (!brand || running) return
    setRunning(true); setError(null); setMatchError(null)
    try {
      const session = await supabase.auth.getSession()
      const token = session.data.session?.access_token || ''
      const res = await fetch('/api/reconciliation/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ brand }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Match failed')
    } catch (e: any) {
      setMatchError(e?.message || 'Match failed')
    }
    setRunning(false)
    await reloadRef.current()
  }

  // Clear selection on context changes so we never apply a status flip
  // to rows the user can't currently see.
  useEffect(() => { setSelected(new Set()) }, [brand, tab, typeFilter, statusFilter, search])

  async function bulkSetStatus(next: FindingStatus) {
    if (selected.size === 0 || bulkBusy) return
    const label = STATUS_LABEL[next].toLowerCase()
    if (!confirm(`Mark ${selected.size} finding${selected.size === 1 ? '' : 's'} as ${label}?`)) return
    setBulkBusy(true); setError(null)
    try {
      const session = await supabase.auth.getSession()
      const token = session.data.session?.access_token || ''
      const res = await fetch('/api/reconciliation/findings/bulk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids: Array.from(selected), status: next }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Bulk update failed')
      setSelected(new Set())
      await reloadRef.current()
    } catch (e: any) {
      setError(e?.message || 'Bulk update failed')
    }
    setBulkBusy(false)
  }

  function exportCsv() {
    const header = ['Check #', 'Type', 'Status', 'Written', 'Cleared', 'Delta', 'Cleared dates', 'Written date', 'Payee', 'Event', 'Note']
    const lines = [header.join(',')]
    for (const f of filtered) {
      const row = [
        f.check_number,
        TYPE_LABEL[f.finding_type],
        STATUS_LABEL[f.status],
        f.written_amount?.toFixed(2) || '',
        f.cleared_amount_total?.toFixed(2) || '',
        f.amount_delta?.toFixed(2) || '',
        (f.cleared_dates || []).join(' '),
        f.written_date || '',
        f.payee_label || '',
        f.event_label || '',
        (f.note || '').replace(/[\r\n,]/g, ' '),
      ]
      lines.push(row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `reconciliation-${brand}-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
  }

  // Print the currently filtered findings — scoped same as Export CSV
  // (the visible/filtered subset, not manual checkbox selection). Opens
  // a clean printable window with a styled table, totals footer, and a
  // notes section for any rows carrying a free-text note. Auto-triggers
  // window.print() so the user lands directly in the print dialog.
  function printFindings() {
    if (filtered.length === 0) return

    // Build the filter chip label that appears under the page title.
    const filterChips: string[] = []
    if (tab === 'outstanding') {
      filterChips.push('Outstanding')
    } else if (typeFilter !== 'all') {
      filterChips.push(TYPE_LABEL[typeFilter])
    }
    if (statusFilter !== 'all') filterChips.push(STATUS_LABEL[statusFilter])
    if (search.trim()) filterChips.push(`"${search.trim()}"`)
    const filterLabel = filterChips.length > 0 ? filterChips.join(' · ') : 'All findings'

    // Totals across printed rows. amount_delta in the DB is stored as a
    // positive magnitude for mismatch/duplicate findings, so summing it
    // gives the total dollar exposure on the page.
    let totalWritten = 0, totalCleared = 0, totalDelta = 0
    for (const f of filtered) {
      if (f.written_amount != null) totalWritten += f.written_amount
      if (f.cleared_amount_total != null) totalCleared += f.cleared_amount_total
      if (f.amount_delta != null) totalDelta += f.amount_delta
    }

    const printedDate = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    const brandLabel = (brand || '').toUpperCase()

    // HTML-escape user-supplied strings before injecting into the
    // printable doc. Payee / event / note all carry free text.
    const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>
    )[c])

    const rowsHtml = filtered.map(f => {
      const dateStr = (f.cleared_dates && f.cleared_dates.length > 0)
        ? f.cleared_dates.map(d => fmtDate(d)).join(', ')
        : fmtDate(f.written_date)
      return `<tr>
        <td>${esc(f.check_number)}</td>
        <td>${esc(TYPE_LABEL[f.finding_type])}</td>
        <td class="num">${esc(fmtMoney(f.written_amount))}</td>
        <td class="num">${esc(fmtMoney(f.cleared_amount_total))}</td>
        <td class="num delta">${esc(fmtMoney(f.amount_delta))}</td>
        <td>${esc(dateStr)}</td>
        <td>
          <div>${esc(f.payee_label || '—')}</div>
          ${f.event_label ? `<div class="event">${esc(f.event_label)}</div>` : ''}
        </td>
        <td>${esc(STATUS_LABEL[f.status])}</td>
      </tr>`
    }).join('')

    const noteItems = filtered
      .filter(f => f.note && f.note.trim())
      .map(f => `<div class="note"><strong>#${esc(f.check_number)}:</strong> ${esc(f.note)}</div>`)
      .join('')

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Reconciliation — ${esc(filterLabel)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1f2937; padding: 24px; margin: 0; }
  .header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #1f2937; padding-bottom: 8px; margin-bottom: 16px; }
  h1 { font-size: 18pt; margin: 0; }
  h1 .brand { font-size: 11pt; color: #6b7280; font-weight: 600; margin-left: 8px; }
  .filter { font-size: 10pt; color: #374151; font-weight: 600; margin-top: 4px; }
  .meta { font-size: 9pt; color: #6b7280; text-align: right; }
  table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  th, td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; font-weight: 700; font-size: 8pt; text-transform: uppercase; color: #374151; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.delta { color: #b91c1c; font-weight: 600; }
  td .event { font-size: 8pt; color: #6b7280; margin-top: 2px; }
  tfoot td { border-top: 2px solid #1f2937; border-bottom: none; font-weight: 700; background: #f9fafb; }
  tr { page-break-inside: avoid; }
  .notes { margin-top: 18px; }
  .notes h2 { font-size: 11pt; margin: 0 0 6px 0; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
  .note { font-size: 9pt; color: #374151; margin-bottom: 4px; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <div class="header">
    <div>
      <h1>🏦 Reconciliation <span class="brand">· ${esc(brandLabel)}</span></h1>
      <div class="filter">${esc(filterLabel)} · ${filtered.length} ${filtered.length === 1 ? 'finding' : 'findings'}</div>
    </div>
    <div class="meta">Printed ${esc(printedDate)}</div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Check #</th>
        <th>Type</th>
        <th class="num">Written</th>
        <th class="num">Cleared</th>
        <th class="num">Δ</th>
        <th>Date</th>
        <th>Payee · Event</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
    <tfoot>
      <tr>
        <td colspan="2">Totals</td>
        <td class="num">${esc(fmtMoney(totalWritten))}</td>
        <td class="num">${esc(fmtMoney(totalCleared))}</td>
        <td class="num delta">${esc(fmtMoney(totalDelta))}</td>
        <td colspan="3"></td>
      </tr>
    </tfoot>
  </table>

  ${noteItems ? `<div class="notes"><h2>Notes</h2>${noteItems}</div>` : ''}

  <script>
    // Pop the print dialog as soon as the doc paints. Small delay so the
    // print preview shows the styled doc, not a flash of unstyled content.
    window.addEventListener('load', function () { setTimeout(function () { window.print() }, 100) })
  </script>
</body>
</html>`

    const w = window.open('', '_blank', 'width=900,height=700')
    if (!w) {
      alert('Pop-up blocked — please allow pop-ups for this site to print.')
      return
    }
    w.document.open()
    w.document.write(html)
    w.document.close()
  }

  if (!isAllowed) {
    return (
      <div className="p-6" style={{ maxWidth: 800, margin: '0 auto' }}>
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--mist)' }}>
          You don't have access to the reconciliation tool. Ask an admin if you should.
        </div>
      </div>
    )
  }

  return (
    <div className="p-6" style={{ maxWidth: 1300, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 10, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)' }}>
          🏦 Reconciliation <span style={{ fontSize: 13, color: 'var(--mist)', fontWeight: 700 }}>· {brand?.toUpperCase()}</span>
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={reRunMatch} disabled={running} className="btn-outline btn-sm">
            {running ? 'Matching…' : '↻ Re-run matching'}
          </button>
          <button onClick={printFindings} disabled={filtered.length === 0} className="btn-outline btn-sm" title={`Print ${filtered.length} ${filtered.length === 1 ? 'finding' : 'findings'} (current filter)`}>🖨 Print</button>
          <button onClick={exportCsv} className="btn-outline btn-sm">⬇ Export CSV</button>
        </div>
      </div>

      <UploadCard
        brand={brand!}
        lastImport={lastImport}
        onImported={() => void reloadRef.current()}
        onMatchError={setMatchError}
      />
      {matchError && (
        <div className="card" style={{ padding: 10, marginBottom: 12, background: '#FEE2E2', color: '#991B1B' }}>
          <strong>Match step failed:</strong> {matchError}. Cleared rows are saved; click "Re-run matching" once the issue is fixed.
        </div>
      )}

      <LetterSettings brand={brand!} />

      {error && (
        <div className="card" style={{ padding: 12, marginBottom: 12, background: '#FEE2E2', color: '#991B1B' }}>{error}</div>
      )}

      <SummaryTiles counts={counts} active={typeFilter} onClick={(t) => { setTab(t === 'outstanding' ? 'outstanding' : 'findings'); setTypeFilter(t === 'matched' ? 'all' : t) }} />

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, background: 'var(--cream2)', padding: 4, borderRadius: 10, width: 'fit-content', marginBottom: 12 }}>
        {(['findings', 'outstanding'] as const).map(t => {
          const sel = tab === t
          return (
            <button key={t} onClick={() => { setTab(t); setTypeFilter('all') }}
              style={{
                fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
                padding: '6px 14px', border: 'none', borderRadius: 6,
                background: sel ? '#fff' : 'transparent',
                color: sel ? 'var(--green-dark)' : 'var(--mist)', cursor: 'pointer',
                boxShadow: sel ? '0 1px 3px rgba(0,0,0,.06)' : 'none',
              }}>
              {t === 'findings' ? 'Findings' : 'Outstanding'}
            </button>
          )
        })}
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: 10, padding: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="search" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search check #, payee, event, note…"
          style={{ flex: '1 1 240px', maxWidth: 360, fontSize: 12, padding: '6px 10px' }} />
        {tab === 'findings' && (
          <>
            {(['all', 'amount_mismatch', 'duplicate_clearing', 'orphan_cleared'] as const).map(t => (
              <button key={t} onClick={() => setTypeFilter(t)}
                className={typeFilter === t ? 'btn-primary btn-xs' : 'btn-outline btn-xs'}>
                {t === 'all' ? 'All' : TYPE_LABEL[t as FindingType]}
              </button>
            ))}
          </>
        )}
        <div style={{ flex: 1 }} />
        {(['all', 'open', 'disputed', 'resolved', 'ignored'] as const).map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={statusFilter === s ? 'btn-primary btn-xs' : 'btn-outline btn-xs'}
            style={{ textTransform: 'capitalize' }}>{s}</button>
        ))}
      </div>

      {selected.size > 0 && (
        <div className="card" style={{
          padding: '8px 12px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--cream2)', flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>{selected.size} selected</span>
          <div style={{ flex: 1 }} />
          <button onClick={() => bulkSetStatus('resolved')} disabled={bulkBusy} className="btn-primary btn-xs">Mark resolved</button>
          <button onClick={() => bulkSetStatus('ignored')}  disabled={bulkBusy} className="btn-outline btn-xs">Mark ignored</button>
          <button onClick={() => bulkSetStatus('disputed')} disabled={bulkBusy} className="btn-outline btn-xs">Mark disputed</button>
          <button onClick={() => setSelected(new Set())}    disabled={bulkBusy} className="btn-outline btn-xs">Cancel</button>
        </div>
      )}

      {findings === null ? (
        <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--mist)' }}>Loading…</div>
      ) : tab === 'outstanding' ? (
        <OutstandingTable findings={filtered} onOpen={setOpenId} />
      ) : filtered.length === 0 ? (
        <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--mist)' }}>
          {(findings.length === 0) ? 'Upload a Wells Fargo CSV to start.' : 'Nothing matches the current filters.'}
        </div>
      ) : (
        <FindingsTable
          findings={filtered}
          onOpen={setOpenId}
          selected={selected}
          onToggleSelect={(id) => {
            setSelected(prev => {
              const next = new Set(prev)
              if (next.has(id)) next.delete(id); else next.add(id)
              return next
            })
          }}
          onToggleAll={() => {
            const allIds = filtered.map(f => f.id)
            const allSelected = allIds.every(id => selected.has(id))
            setSelected(allSelected ? new Set() : new Set(allIds))
          }}
          allSelected={filtered.length > 0 && filtered.every(f => selected.has(f.id))}
        />
      )}

      {openId && (
        <FindingDetailModal
          findingId={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => void reloadRef.current()}
          setNav={setNav}
        />
      )}
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────── */

function UploadCard({
  brand, lastImport, onImported, onMatchError,
}: {
  brand: string
  lastImport: ImportRow | null | 'loading'
  onImported: () => void
  onMatchError: (msg: string | null) => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [last, setLast] = useState<{ imported: number; skipped: number; duplicates: number; filename: string } | null>(null)

  async function handleFile(file: File) {
    if (!file) return
    setBusy(true); setErr(null); setLast(null)
    try {
      const text = await file.text()
      const session = await supabase.auth.getSession()
      const token = session.data.session?.access_token || ''
      const res = await fetch('/api/reconciliation/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ brand, filename: file.name, csv: text }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Upload failed')
      setLast({
        imported: json.imported_count, skipped: json.skipped_count,
        duplicates: json.duplicate_count, filename: file.name,
      })
      // The import succeeded but the matcher might have errored — surface
      // it so we don't silently leave the user with no findings.
      onMatchError(json?.match_error || null)
      onImported()
    } catch (e: any) {
      setErr(e?.message || 'Upload failed')
    }
    setBusy(false)
  }

  return (
    <div className="card" style={{ padding: 14, marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)', marginBottom: 4 }}>
            Wells Fargo CSV import
          </div>
          {lastImport === 'loading' ? (
            <div style={{ fontSize: 12, color: 'var(--mist)' }}>Loading last import…</div>
          ) : lastImport ? (
            <div style={{ fontSize: 12, color: 'var(--mist)' }}>
              Last: <strong>{lastImport.filename}</strong> · {fmtDate(lastImport.uploaded_at)} · {lastImport.imported_count} imported, {lastImport.duplicate_count} duplicates, {lastImport.skipped_count} skipped
            </div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--mist)' }}>No imports yet.</div>
          )}
        </div>
        <label className="btn-primary btn-sm" style={{ cursor: 'pointer' }}>
          {busy ? 'Importing…' : '⬆ Upload CSV'}
          <input type="file" accept=".csv,text/csv" disabled={busy}
            onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.currentTarget.value = '' }}
            style={{ display: 'none' }} />
        </label>
      </div>
      {err && <div style={{ marginTop: 8, padding: 8, background: '#FEE2E2', color: '#991B1B', borderRadius: 6, fontSize: 12 }}>{err}</div>}
      {last && (
        <div style={{ marginTop: 8, padding: 8, background: '#D1FAE5', color: '#065F46', borderRadius: 6, fontSize: 12 }}>
          ✓ {last.filename}: imported {last.imported}, skipped {last.skipped}, {last.duplicates} duplicates.
        </div>
      )}
    </div>
  )
}

function LetterSettings({ brand }: { brand: string }) {
  const [open, setOpen] = useState(false)
  const [address, setAddress] = useState('')
  const [lastFour, setLastFour] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const { user } = useApp()

  useEffect(() => {
    if (!open || loaded) return
    let cancelled = false
    void (async () => {
      const { data } = await withTimeout(
        supabase.from('settings').select('key, value')
          .in('key', [`reconciliation.${brand}.address`, `reconciliation.${brand}.account_last_four`]),
      )
      if (cancelled) return
      const byKey = new Map<string, any>(((data || []) as any[]).map(r => [r.key, r.value]))
      const stripQuotes = (v: any) => typeof v === 'string' ? v.replace(/^"|"$/g, '') : ''
      setAddress(stripQuotes(byKey.get(`reconciliation.${brand}.address`)))
      setLastFour(stripQuotes(byKey.get(`reconciliation.${brand}.account_last_four`)))
      setLoaded(true)
    })()
    return () => { cancelled = true }
  }, [open, brand, loaded])

  // Reset cached values when brand switches.
  useEffect(() => { setLoaded(false); setMsg(null); setErr(null) }, [brand])

  async function save() {
    setBusy(true); setErr(null); setMsg(null)
    try {
      // Match the existing settings pattern (TagsAndEngagement et al.):
      // values are JSON.stringify'd into JSONB so reads always come
      // back as a JSON-encoded string the readers can strip.
      const rows = [
        { key: `reconciliation.${brand}.address`,
          value: JSON.stringify(address.trim() || ''),
          updated_at: new Date().toISOString(), updated_by: user?.id || null },
        { key: `reconciliation.${brand}.account_last_four`,
          value: JSON.stringify(lastFour.trim().slice(0, 4) || ''),
          updated_at: new Date().toISOString(), updated_by: user?.id || null },
      ]
      const { error } = await withTimeout(
        supabase.from('settings').upsert(rows, { onConflict: 'key' }),
      )
      if (error) throw new Error(error.message)
      setMsg('Saved.')
      setTimeout(() => setMsg(null), 1800)
    } catch (e: any) {
      setErr(e?.message || 'Save failed')
    }
    setBusy(false)
  }

  return (
    <div className="card" style={{ padding: 0, marginBottom: 12, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', textAlign: 'left',
          background: 'transparent', border: 'none', cursor: 'pointer',
          padding: '10px 14px', fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          fontSize: 12, color: 'var(--mist)',
        }}>
        <span><strong style={{ color: 'var(--ink)' }}>Dispute letter settings</strong> · {brand?.toUpperCase()}</span>
        <span>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div style={{ padding: '0 14px 14px', borderTop: '1px solid var(--pearl)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginTop: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--mist)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                Brand address (printed at the top of the letter)
              </label>
              <textarea
                value={address}
                onChange={e => setAddress(e.target.value)}
                rows={3}
                placeholder={'123 Main St\nSuite 200\nAnytown, ST 12345'}
                style={{ width: '100%', boxSizing: 'border-box', padding: 8, fontSize: 13, fontFamily: 'inherit', borderRadius: 6, border: '1px solid var(--pearl)' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--mist)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                Account last 4
              </label>
              <input
                type="text"
                value={lastFour}
                onChange={e => setLastFour(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="1234"
                inputMode="numeric"
                maxLength={4}
                style={{ width: '100%', boxSizing: 'border-box', padding: 8, fontSize: 13, fontFamily: 'inherit', borderRadius: 6, border: '1px solid var(--pearl)' }}
              />
              <div style={{ fontSize: 10, color: 'var(--mist)', marginTop: 4 }}>
                Shown as "Account ending ··{lastFour || '____'}" in the letter subject.
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <button onClick={save} disabled={busy} className="btn-primary btn-sm">
              {busy ? 'Saving…' : 'Save'}
            </button>
            {msg && <span style={{ fontSize: 12, color: 'var(--green)' }}>✓ {msg}</span>}
            {err && <span style={{ fontSize: 12, color: '#991B1B' }}>{err}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryTiles({
  counts, active, onClick,
}: {
  counts: Record<FindingType, number>
  active: 'all' | FindingType
  onClick: (t: FindingType) => void
}) {
  const tiles: { type: FindingType }[] = [
    { type: 'matched' },
    { type: 'amount_mismatch' },
    { type: 'duplicate_clearing' },
    { type: 'orphan_cleared' },
    { type: 'outstanding' },
  ]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginBottom: 12 }}>
      {tiles.map(t => {
        const c = TYPE_COLOR[t.type]
        const isActive = active === t.type
        return (
          <button key={t.type} onClick={() => onClick(t.type)}
            style={{
              textAlign: 'left', padding: '12px 14px', borderRadius: 10,
              background: c.bg, border: isActive ? `2px solid ${c.fg}` : '1px solid var(--cream2)',
              cursor: 'pointer', fontFamily: 'inherit',
            }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: c.fg, textTransform: 'uppercase', letterSpacing: '.04em' }}>
              {TYPE_ICON[t.type]} {TYPE_LABEL[t.type]}
            </div>
            <div style={{ fontSize: 22, fontWeight: 900, color: c.fg, marginTop: 4 }}>
              {counts[t.type] ?? 0}
            </div>
          </button>
        )
      })}
    </div>
  )
}

function FindingsTable({
  findings, onOpen, selected, onToggleSelect, onToggleAll, allSelected,
}: {
  findings: Finding[]
  onOpen: (id: string) => void
  selected: Set<string>
  onToggleSelect: (id: string) => void
  onToggleAll: () => void
  allSelected: boolean
}) {
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--cream2)' }}>
              <th style={{ padding: '8px 10px', width: 28 }}>
                <Checkbox checked={allSelected} onChange={onToggleAll} size={16} />
              </th>
              {['Check #', 'Type', 'Written', 'Cleared', 'Δ', 'Cleared on', 'Payee · Event', 'Status', ''].map(h => (
                <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--mist)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {findings.map(f => {
              const tc = TYPE_COLOR[f.finding_type]
              const sc = STATUS_COLOR[f.status]
              const isSelected = selected.has(f.id)
              return (
                <tr key={f.id} onClick={() => onOpen(f.id)}
                  style={{
                    cursor: 'pointer', borderTop: '1px solid var(--pearl)',
                    background: isSelected ? 'var(--cream2)' : undefined,
                  }}>
                  <td style={{ padding: '8px 10px', width: 28 }}
                    onClick={e => { e.stopPropagation(); onToggleSelect(f.id) }}>
                    <Checkbox checked={isSelected} onChange={() => onToggleSelect(f.id)} size={16} />
                  </td>
                  <td style={{ padding: '8px 10px', fontWeight: 700 }}>{f.check_number}</td>
                  <td style={{ padding: '8px 10px' }}>
                    <span style={{ background: tc.bg, color: tc.fg, padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap' }}>
                      {TYPE_ICON[f.finding_type]} {TYPE_LABEL[f.finding_type]}
                    </span>
                  </td>
                  <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{fmtMoney(f.written_amount)}</td>
                  <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                    {fmtMoney(f.cleared_amount_total)}
                    {f.cleared_count > 1 && <span style={{ color: 'var(--mist)' }}> ×{f.cleared_count}</span>}
                  </td>
                  <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: f.amount_delta && Math.abs(f.amount_delta) > 0.01 ? '#991B1B' : 'var(--mist)' }}>
                    {f.amount_delta != null ? fmtMoney(Math.abs(f.amount_delta)) : '—'}
                  </td>
                  <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: 'var(--mist)' }}>
                    {(f.cleared_dates || []).slice(0, 2).map(fmtDate).join(', ') || '—'}
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    <div style={{ fontSize: 12 }}>{f.payee_label || '—'}</div>
                    <div style={{ fontSize: 11, color: 'var(--mist)' }}>{f.event_label || '—'}</div>
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    <span style={{ background: sc.bg, color: sc.fg, padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 800 }}>
                      {STATUS_LABEL[f.status]}
                    </span>
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>→</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function OutstandingTable({ findings, onOpen }: { findings: Finding[]; onOpen: (id: string) => void }) {
  // Bucket by age of written_date.
  const buckets: { label: string; range: [number, number]; color: string; bg: string; rows: Finding[] }[] = [
    { label: '0–30 days',  range: [0, 30],     color: '#065F46', bg: '#D1FAE5', rows: [] },
    { label: '30–60 days', range: [30, 60],    color: '#92400E', bg: '#FEF3C7', rows: [] },
    { label: '60–90 days', range: [60, 90],    color: '#9A3412', bg: '#FED7AA', rows: [] },
    { label: '90+ days',   range: [90, Infinity], color: '#991B1B', bg: '#FEE2E2', rows: [] },
  ]
  for (const f of findings) {
    const age = daysSince(f.written_date)
    const b = buckets.find(b => age >= b.range[0] && age < b.range[1])
    if (b) b.rows.push(f)
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {buckets.map(b => (
        <div key={b.label} className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', background: b.bg, color: b.color, fontWeight: 800, fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{b.label}</span>
            <span>
              {b.rows.length} outstanding
              {b.range[0] >= 90 && b.rows.length > 0 && (
                <span style={{ marginLeft: 8, fontWeight: 600, fontSize: 11 }}>
                  · consider stop-payment + reissue
                </span>
              )}
            </span>
          </div>
          {b.rows.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <tbody>
                  {b.rows.map(f => (
                    <tr key={f.id} onClick={() => onOpen(f.id)} style={{ cursor: 'pointer', borderTop: '1px solid var(--pearl)' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 700 }}>#{f.check_number}</td>
                      <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{fmtMoney(f.written_amount)}</td>
                      <td style={{ padding: '8px 12px' }}>
                        <div style={{ fontSize: 12 }}>{f.payee_label || '—'}</div>
                        <div style={{ fontSize: 11, color: 'var(--mist)' }}>{f.event_label || '—'}</div>
                      </td>
                      <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: 'var(--mist)' }}>
                        Written {fmtDate(f.written_date)} · {daysSince(f.written_date)}d ago
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>→</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function FindingDetailModal({
  findingId, onClose, onChanged, setNav,
}: {
  findingId: string
  onClose: () => void
  onChanged: () => void
  /** Optional — when set, the per-row "Open Register" button uses
   *  it (with setDayEntryIntent) to deep-link into Day Entry on
   *  the source's event + day. Falls back to "no button" when
   *  unset (e.g. embedded views without nav). */
  setNav?: (n: NavPage) => void
}) {
  const { setDayEntryIntent } = useApp()
  const [finding, setFinding] = useState<Finding | null>(null)
  const [clearings, setClearings] = useState<ClearedCheck[]>([])
  const [writtenChecks, setWrittenChecks] = useState<{
    source_table: 'buyer_checks' | 'event_days'
    source_id: string
    source_label: string
    amount: number
    day_number: number | null
    payment_type: string | null
    event_id: string | null
    event_label: string | null
  }[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  // editValue = amount input; editCheck = check_number input.
  // Both populate from the current source row when Edit is clicked;
  // Save sends only the fields that actually changed.
  const [editValue, setEditValue] = useState('')
  const [editCheck, setEditCheck] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data, error } = await withTimeout(
        supabase.from('reconciliation_findings').select('*').eq('id', findingId).maybeSingle(),
      )
      if (cancelled) return
      if (error || !data) { setErr(error?.message || 'Finding not found'); return }
      setFinding(data as Finding)
      setNote((data as Finding).note || '')

      const f = data as Finding
      const [clearedRes, buyerChecksRes, edRes] = await Promise.all([
        withTimeout(
          supabase.from('cleared_checks').select('*')
            .eq('brand', f.brand).eq('check_number', f.check_number)
            .order('cleared_date', { ascending: true }),
        ),
        withTimeout(
          supabase.from('buyer_checks').select('id, amount, day_number, payment_type, event_id')
            .eq('check_number', f.check_number),
        ),
        withTimeout(
          supabase.from('event_days').select('id, day_number, store_commission_check_amount, store_commission_check_number, event_id')
            .eq('store_commission_check_number', f.check_number),
        ),
      ])
      if (cancelled) return
      setClearings((clearedRes.data || []) as ClearedCheck[])

      // Resolve event labels for every source row so the user can tell
      // which event each duplicate came from.
      const allEventIds = Array.from(new Set([
        ...((buyerChecksRes.data || []) as any[]).map(r => r.event_id),
        ...((edRes.data || []) as any[]).map(r => r.event_id),
      ].filter(Boolean) as string[]))
      let eventById = new Map<string, { store_name: string | null; start_date: string | null }>()
      if (allEventIds.length > 0) {
        const { data: evRows } = await withTimeout(
          supabase.from('events').select('id, store_name, start_date').in('id', allEventIds),
        )
        eventById = new Map(((evRows || []) as any[]).map(e => [e.id, { store_name: e.store_name, start_date: e.start_date }]))
      }
      const labelFor = (event_id: string | null): string | null => {
        if (!event_id) return null
        const e = eventById.get(event_id)
        if (!e) return null
        return [e.store_name, e.start_date ? fmtDate(e.start_date) : null].filter(Boolean).join(' · ')
      }

      const writes: typeof writtenChecks = []
      for (const r of (buyerChecksRes.data || []) as any[]) {
        writes.push({
          source_table: 'buyer_checks', source_id: r.id, source_label: 'buyer_checks',
          amount: Number(r.amount) || 0, day_number: r.day_number, payment_type: r.payment_type,
          event_id: r.event_id, event_label: labelFor(r.event_id),
        })
      }
      for (const r of (edRes.data || []) as any[]) {
        writes.push({
          source_table: 'event_days', source_id: r.id, source_label: 'event_days commission',
          amount: Number(r.store_commission_check_amount) || 0, day_number: r.day_number, payment_type: null,
          event_id: r.event_id, event_label: labelFor(r.event_id),
        })
      }
      setWrittenChecks(writes)
    })()
    return () => { cancelled = true }
  }, [findingId])

  async function saveWrittenAmount(source_table: 'buyer_checks' | 'event_days', source_id: string) {
    if (!finding) return
    // Figure out the original values so we only send the fields
    // the user actually changed. Saves an unnecessary write when
    // they only touched one field.
    const row = writtenChecks.find(w => w.source_id === source_id && w.source_table === source_table)
    if (!row) { setErr('Row not found'); return }

    const v = Number(editValue)
    if (!Number.isFinite(v) || v < 0) { setErr('Enter a non-negative number'); return }
    const trimmedCheck = editCheck.trim()
    if (trimmedCheck.length === 0) { setErr('Check # cannot be empty'); return }

    const amountChanged = Math.abs(v - row.amount) > 0.005
    const checkChanged  = trimmedCheck !== (finding.check_number || '')
    if (!amountChanged && !checkChanged) {
      // No-op — close the editor without hitting the API.
      setEditingId(null); setEditValue(''); setEditCheck('')
      return
    }

    const payload: Record<string, unknown> = { source_table, source_id }
    if (amountChanged) payload.new_amount = v
    if (checkChanged)  payload.new_check_number = trimmedCheck

    setBusy(true); setErr(null)
    try {
      const session = await supabase.auth.getSession()
      const token = session.data.session?.access_token || ''
      const res = await fetch(`/api/reconciliation/findings/${finding.id}/edit-written`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Update failed')
      // Update local row state. NOTE: if the user changed
      // check_number, the source row likely no longer belongs to
      // THIS finding (the finding is keyed on check_number).
      // onChanged() refreshes the parent list; the user will see
      // the new state on next open.
      if (amountChanged && !checkChanged) {
        setWrittenChecks(prev => prev.map(w =>
          w.source_id === source_id && w.source_table === source_table
            ? { ...w, amount: v }
            : w,
        ))
      } else {
        // check_number changed — drop the row from the local
        // sources list since it no longer matches this finding.
        setWrittenChecks(prev => prev.filter(w =>
          !(w.source_id === source_id && w.source_table === source_table),
        ))
      }
      setEditingId(null)
      setEditValue('')
      setEditCheck('')
      onChanged()
    } catch (e: any) {
      setErr(e?.message || 'Update failed')
    }
    setBusy(false)
  }

  async function setStatus(next: FindingStatus) {
    if (!finding) return
    setBusy(true); setErr(null)
    try {
      const session = await supabase.auth.getSession()
      const token = session.data.session?.access_token || ''
      const res = await fetch(`/api/reconciliation/findings/${finding.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: next, note }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Update failed')
      setFinding(json.finding as Finding)
      onChanged()
    } catch (e: any) {
      setErr(e?.message || 'Update failed')
    }
    setBusy(false)
  }

  async function saveNote() {
    if (!finding) return
    setBusy(true); setErr(null)
    try {
      const session = await supabase.auth.getSession()
      const token = session.data.session?.access_token || ''
      const res = await fetch(`/api/reconciliation/findings/${finding.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ note }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Save failed')
      setFinding(json.finding as Finding)
      onChanged()
    } catch (e: any) { setErr(e?.message || 'Save failed') }
    setBusy(false)
  }

  async function markNotEventCheck() {
    if (!finding) return
    if (!confirm(`Mark check #${finding.check_number} as not an event check (rent, payroll, vendor)? Future imports will auto-classify it as ignored.`)) return
    setBusy(true); setErr(null)
    try {
      const session = await supabase.auth.getSession()
      const token = session.data.session?.access_token || ''
      const res = await fetch(`/api/reconciliation/findings/${finding.id}/mark-not-event-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ note }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Failed')
      onChanged()
      onClose()
    } catch (e: any) { setErr(e?.message || 'Failed') }
    setBusy(false)
  }

  async function downloadDisputeLetter() {
    if (!finding) return
    // The API requires an Authorization: Bearer header. window.open()
    // can't attach custom headers, so it returned 401. Fetch the PDF
    // with the auth header, then surface it via a blob URL.
    setBusy(true); setErr(null)
    try {
      const session = await supabase.auth.getSession()
      const token = session.data.session?.access_token || ''
      const res = await fetch(`/api/reconciliation/findings/${finding.id}/dispute-letter`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        let msg = `Dispute letter failed (${res.status})`
        try { const j = await res.json(); if (j?.error) msg = j.error } catch {}
        throw new Error(msg)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank')
      // Revoke after a delay so the new tab has time to load.
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e: any) {
      setErr(e?.message || 'Failed to open dispute letter')
    }
    setBusy(false)
  }

  return (
    <div onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}>
      <div onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 12, maxWidth: 700, width: '100%',
          maxHeight: '90vh', overflow: 'auto', padding: 22, fontFamily: 'inherit',
        }}>
        {!finding ? (
          <div>Loading…</div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                  {TYPE_ICON[finding.finding_type]} {TYPE_LABEL[finding.finding_type]}
                </div>
                <div style={{ fontSize: 20, fontWeight: 900 }}>Check #{finding.check_number}</div>
              </div>
              <button onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--mist)' }}>×</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--mist)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em' }}>Written</div>
                <div style={{ fontSize: 18, fontWeight: 800 }}>{fmtMoney(finding.written_amount)}</div>
                <div style={{ fontSize: 12, color: 'var(--mist)' }}>{finding.payee_label || '—'}</div>
                <div style={{ fontSize: 12, color: 'var(--mist)' }}>{finding.event_label || '—'}</div>
                <div style={{ fontSize: 12, color: 'var(--mist)' }}>Date: {fmtDate(finding.written_date)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--mist)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em' }}>Cleared</div>
                <div style={{ fontSize: 18, fontWeight: 800 }}>
                  {fmtMoney(finding.cleared_amount_total)}
                  {finding.cleared_count > 1 && <span style={{ color: 'var(--mist)', fontSize: 13 }}> ({finding.cleared_count}×)</span>}
                </div>
                {finding.amount_delta != null && Math.abs(finding.amount_delta) > 0.01 && (
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#991B1B', marginTop: 4 }}>
                    Δ {fmtMoney(Math.abs(finding.amount_delta))} {finding.amount_delta > 0 ? 'short' : 'over'}
                  </div>
                )}
              </div>
            </div>

            {clearings.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: 'var(--mist)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>Clearings</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--cream2)' }}>
                      <th style={{ padding: 6, textAlign: 'left' }}>Date</th>
                      <th style={{ padding: 6, textAlign: 'left' }}>Amount</th>
                      <th style={{ padding: 6, textAlign: 'left' }}>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clearings.map(c => (
                      <tr key={c.id} style={{ borderTop: '1px solid var(--pearl)' }}>
                        <td style={{ padding: 6 }}>{fmtDate(c.cleared_date)}</td>
                        <td style={{ padding: 6 }}>{fmtMoney(c.cleared_amount)}</td>
                        <td style={{ padding: 6 }}>{c.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {writtenChecks.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: 'var(--mist)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>
                  Written sources <span style={{ fontWeight: 600, textTransform: 'none' }}>· click ✎ to fix a typo'd amount</span>
                </div>
                {writtenChecks.length > 1 && (
                  <div style={{ marginBottom: 8, padding: 8, background: '#FEF3C7', color: '#92400E', borderRadius: 6, fontSize: 12 }}>
                    ⚠ This check number was entered into the ledger {writtenChecks.length} times across different events. Most likely one of them is a typo (someone wrote the wrong number on a different check). The matcher sums all the amounts as the "written" total — so a real one-clearing match looks like a mismatch until the duplicate entries are fixed or deleted.
                  </div>
                )}
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--cream2)' }}>
                      <th style={{ padding: 6, textAlign: 'left', fontSize: 10, color: 'var(--mist)' }}>Event</th>
                      <th style={{ padding: 6, textAlign: 'left', fontSize: 10, color: 'var(--mist)' }}>Source</th>
                      <th style={{ padding: 6, textAlign: 'left', fontSize: 10, color: 'var(--mist)' }}>Check #</th>
                      <th style={{ padding: 6, textAlign: 'left', fontSize: 10, color: 'var(--mist)' }}>Amount</th>
                      <th style={{ padding: 6, textAlign: 'left', fontSize: 10, color: 'var(--mist)' }}>Day</th>
                      <th style={{ padding: 6, textAlign: 'right' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {writtenChecks.map((w) => {
                      const isEditing = editingId === w.source_id
                      return (
                        <tr key={w.source_id} style={{ borderTop: '1px solid var(--pearl)' }}>
                          <td style={{ padding: 6 }}>
                            <div>{w.event_label || <span style={{ color: 'var(--mist)' }}>(unknown event)</span>}</div>
                            {w.payment_type && (
                              <div style={{ fontSize: 10, color: 'var(--mist)' }}>{w.payment_type}</div>
                            )}
                          </td>
                          <td style={{ padding: 6, color: 'var(--mist)' }}>{w.source_label}</td>
                          <td style={{ padding: 6, whiteSpace: 'nowrap' }}>
                            {/* Check # column. View mode shows the finding's
                                check_number (all rows in writtenChecks share
                                it — this group IS the duplicate-entries pile
                                for that number). Edit mode becomes an input
                                so the operator can fix a typo'd check #
                                in place — the common "wrote the wrong
                                number on a different check" failure mode. */}
                            {isEditing ? (
                              <input type="text" value={editCheck}
                                onChange={e => setEditCheck(e.target.value)}
                                style={{ width: 100, padding: '4px 6px', fontSize: 12, border: '1px solid var(--pearl)', borderRadius: 4, fontFamily: 'monospace' }} />
                            ) : (
                              <span style={{ fontFamily: 'monospace', color: 'var(--mist)' }}>#{finding?.check_number}</span>
                            )}
                          </td>
                          <td style={{ padding: 6, whiteSpace: 'nowrap' }}>
                            {isEditing ? (
                              <input type="number" min={0} step="0.01" value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                autoFocus
                                style={{ width: 100, padding: '4px 6px', fontSize: 12, border: '1px solid var(--pearl)', borderRadius: 4 }} />
                            ) : (
                              <strong>{fmtMoney(w.amount)}</strong>
                            )}
                          </td>
                          <td style={{ padding: 6, color: 'var(--mist)' }}>day {w.day_number ?? '—'}</td>
                          <td style={{ padding: 6, textAlign: 'right', whiteSpace: 'nowrap' }}>
                            {isEditing ? (
                              <>
                                <button onClick={() => saveWrittenAmount(w.source_table, w.source_id)}
                                  disabled={busy} className="btn-primary btn-xs">Save</button>
                                <button onClick={() => { setEditingId(null); setEditValue(''); setEditCheck('') }}
                                  disabled={busy} className="btn-outline btn-xs" style={{ marginLeft: 4 }}>Cancel</button>
                              </>
                            ) : (
                              <span style={{ display: 'inline-flex', gap: 4 }}>
                                <button
                                  onClick={() => {
                                    setEditingId(w.source_id)
                                    setEditValue(w.amount.toFixed(2))
                                    setEditCheck(finding?.check_number || '')
                                  }}
                                  disabled={busy}
                                  title="Edit this row's amount and / or check # in the underlying ledger"
                                  className="btn-outline btn-xs">✎ Edit</button>
                                {/* Open Register — deep-link into Day Entry on the
                                    source's event + day so the operator can fix the
                                    actual ledger row (delete a typo'd check, swap
                                    a check #, etc.) rather than just adjust the
                                    amount inline. Only when we have an event_id;
                                    legacy import rows without one stay edit-only. */}
                                {w.event_id && setNav && (
                                  <button
                                    onClick={() => {
                                      onClose()
                                      setDayEntryIntent({
                                        eventId: w.event_id!,
                                        day: w.day_number || 1,
                                        mode: 'buyer',
                                      })
                                      setNav('dayentry')
                                    }}
                                    disabled={busy}
                                    title="Open this check in the Day Entry register so you can edit / delete the source row in context"
                                    className="btn-outline btn-xs">↗ Open Register</button>
                                )}
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: 'var(--mist)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em' }}>Note</label>
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
                placeholder="Optional context for this finding"
                style={{ width: '100%', boxSizing: 'border-box', padding: 8, fontSize: 13, fontFamily: 'inherit', borderRadius: 6, border: '1px solid var(--pearl)' }} />
              <button onClick={saveNote} disabled={busy} className="btn-outline btn-xs" style={{ marginTop: 4 }}>Save note</button>
            </div>

            {err && <div style={{ padding: 8, background: '#FEE2E2', color: '#991B1B', borderRadius: 6, fontSize: 12, marginBottom: 8 }}>{err}</div>}

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {finding.finding_type === 'orphan_cleared' && (
                <button onClick={markNotEventCheck} disabled={busy} className="btn-outline btn-sm">
                  Not an event check
                </button>
              )}
              {(finding.finding_type === 'amount_mismatch' || finding.finding_type === 'duplicate_clearing') && (
                <button onClick={downloadDisputeLetter} disabled={busy} className="btn-outline btn-sm">
                  ⇣ Dispute letter PDF
                </button>
              )}
              {finding.status !== 'open' && (
                <button onClick={() => setStatus('open')} disabled={busy} className="btn-outline btn-sm">Reopen</button>
              )}
              {finding.status !== 'disputed' && (
                <button onClick={() => setStatus('disputed')} disabled={busy} className="btn-outline btn-sm">Mark disputed</button>
              )}
              {finding.status !== 'resolved' && (
                <button onClick={() => setStatus('resolved')} disabled={busy} className="btn-primary btn-sm">Resolve</button>
              )}
              {finding.status !== 'ignored' && (
                <button onClick={() => setStatus('ignored')} disabled={busy} className="btn-outline btn-sm">Ignore</button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
