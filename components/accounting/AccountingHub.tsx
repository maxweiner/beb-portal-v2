'use client'

// Accounting Hub — single-screen dashboard for the accountant.
// Two-pane layout (desktop only):
//   • Left: every expense report awaiting action (Submitted →
//     awaiting approval; Approved → awaiting payment). Aging
//     badge per row (green <7 days, amber 7-13, red 14+).
//     Multi-select checkboxes drive the bulk-paid action.
//   • Right: stripped detail of the selected row — totals + status
//     pill + action buttons (Approve / Mark Paid / Open Full Detail
//     for the line items + receipts in the existing Expenses
//     module).
//
// Header: 3 KPI tiles ($ to review, $ to pay, # overdue).
// Filter bar: status / brand / aging / search (buyer or event).

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useApp } from '@/lib/context'
import { fmtMoney } from '@/lib/format'
import Checkbox from '@/components/ui/Checkbox'
import W9Panel from './W9Panel'
import type { NavPage } from '@/app/page'

interface QueueRow {
  id: string
  status: 'submitted_pending_review' | 'approved' | 'paid'
  buyer_id: string
  buyer_name: string
  event_id: string | null
  event_label: string | null
  brand: string | null
  submitted_at: string | null
  approved_at: string | null
  /** Payment audit fields. Populated when status='paid'. paid_note
   *  is the free-text 'how it was paid' string the accountant
   *  captured at mark-paid time (Check #1234, Wire 5/14, etc.). */
  paid_at?: string | null
  paid_by_user_id?: string | null
  paid_by_name?: string | null
  paid_note?: string | null
  age_days: number
  total_expenses: number
  total_compensation: number
  total_bonus: number
  grand_total: number
  receipt_count: number
  /** Audit fields from the QuickBooks export feature. The detail
   *  panel surfaces these as the "Exported ✓" pill + a re-export
   *  warning so Diane doesn't double-book a Bill into QB. */
  report_number?: string | null
  exported_to_qb_at?: string | null
  exported_to_qb_format?: 'iif' | 'csv' | null
}

// 'paid' shows only paid reports in the lookback window.
// 'all_incl_paid' shows active + paid (lookback'd). The default
// 'all' keeps the historical behavior — active only, no payload bloat.
type StatusFilter = 'all' | 'submitted_pending_review' | 'approved' | 'paid' | 'all_incl_paid'
type BrandFilter  = 'all' | 'beb' | 'liberty'
type AgeFilter    = 'all' | 'overdue' | 'recent'

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
}

function ageColor(days: number): { bg: string; fg: string; label: string } {
  if (days >= 14) return { bg: '#FEE2E2', fg: '#991B1B', label: `${days}d` }
  if (days >= 7)  return { bg: '#FEF3C7', fg: '#92400E', label: `${days}d` }
  return { bg: '#DCFCE7', fg: '#166534', label: `${days}d` }
}

interface Props {
  setNav?: (n: NavPage) => void
}

export default function AccountingHub({ setNav }: Props) {
  const { user, brand } = useApp()
  const isAllowed = user?.role === 'accounting' || user?.role === 'admin' || user?.role === 'superadmin' || user?.is_partner === true

  const [rows, setRows] = useState<QueueRow[] | null>(null)
  const [err, setErr]   = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)
  // Fullscreen workspace. AccountingHub already has its own
  // title + toolbar so we toggle the OUTER container's styling
  // directly (position:fixed; inset:0) rather than wrapping in
  // <FullscreenWorkspace /> — avoids a duplicate title bar.
  const [fullscreen, setFullscreen] = useState(false)

  // ESC dismiss + body scroll-lock while fullscreen.
  useEffect(() => {
    if (!fullscreen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setFullscreen(false)
    }
    document.addEventListener('keydown', onKey)
    const priorOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = priorOverflow
    }
  }, [fullscreen])

  // Filters. Brand auto-scopes to the brand picker on first mount —
  // when the user is in Liberty mode, the queue shows Liberty reports
  // only; same for BEB. They can still flip to "All brands" to see
  // both. The brandFilter state also re-syncs when the user changes
  // brands via the top-of-portal switcher (effect below).
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [brandFilter,  setBrandFilter]  = useState<BrandFilter>(
    brand === 'beb' || brand === 'liberty' ? brand : 'all'
  )
  const [ageFilter,    setAgeFilter]    = useState<AgeFilter>('all')
  const [search,       setSearch]       = useState('')

  // Keep brand filter in sync with the global brand picker.
  useEffect(() => {
    if (brand === 'beb' || brand === 'liberty') {
      setBrandFilter(brand)
    }
  }, [brand])

  // Selection (multi-select for bulk-paid)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [activeId, setActiveId] = useState<string | null>(null)

  // Bulk-paid state
  const [paying, setPaying] = useState(false)
  const [notifyOnPay, setNotifyOnPay] = useState(true)
  const [payResult, setPayResult] = useState<{ paid: number; emails: number; failed: number } | null>(null)

  // Single-row action busy state
  const [busyId, setBusyId] = useState<string | null>(null)

  // Mark-Paid modal state. Used for both single-row and bulk paths
  // so the note prompt is consistent. mode='single' fires the
  // /mark-paid endpoint with the report id; mode='bulk' fires the
  // /accounting-hub/bulk-paid endpoint with every picked id.
  const [payModal, setPayModal] = useState<{
    mode: 'single' | 'bulk'
    ids: string[]
    label: string
  } | null>(null)

  useEffect(() => {
    if (!isAllowed) return
    let cancelled = false
    ;(async () => {
      setErr(null)
      try {
        // Only fetch paid rows when the user actually wants to see
        // them — keeps the default payload lean. Server caps the
        // lookback at 90 days unless we override.
        const includePaid = statusFilter === 'paid' || statusFilter === 'all_incl_paid'
        const url = includePaid
          ? '/api/accounting-hub?include_paid=true&paid_lookback_days=90'
          : '/api/accounting-hub'
        const r = await fetch(url, { headers: await authHeaders() })
        const j = await r.json().catch(() => ({}))
        if (cancelled) return
        if (!r.ok) { setErr(j.error || `Load failed (${r.status})`); setRows([]); return }
        setRows(j.rows || [])
      } catch (e: any) {
        if (!cancelled) { setErr(e?.message || 'Load failed'); setRows([]) }
      }
    })()
    return () => { cancelled = true }
  }, [isAllowed, refreshTick, statusFilter])

  const filtered = useMemo(() => {
    if (!rows) return []
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      // 'all' = active only (back-compat); 'all_incl_paid' = active + paid.
      // Specific filters match exact status.
      if (statusFilter === 'all' && r.status === 'paid') return false
      if (statusFilter === 'paid' && r.status !== 'paid') return false
      if (statusFilter === 'submitted_pending_review' && r.status !== 'submitted_pending_review') return false
      if (statusFilter === 'approved' && r.status !== 'approved') return false
      // 'all_incl_paid' is no-op — all statuses pass
      if (brandFilter !== 'all' && r.brand !== brandFilter) return false
      if (ageFilter === 'overdue' && r.age_days < 7) return false
      if (ageFilter === 'recent'  && r.age_days >= 7) return false
      if (q) {
        const hay = `${r.buyer_name} ${r.event_label || ''} ${r.paid_note || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, statusFilter, brandFilter, ageFilter, search])

  const groupedFiltered = useMemo(() => {
    const submitted = filtered.filter(r => r.status === 'submitted_pending_review')
      .sort((a, b) => b.age_days - a.age_days)
    const approved  = filtered.filter(r => r.status === 'approved')
      .sort((a, b) => b.age_days - a.age_days)
    // Paid rows: newest payment first (age_days for paid rows is
    // days-since-paid, so ascending is "most recently paid first").
    const paid = filtered.filter(r => r.status === 'paid')
      .sort((a, b) => a.age_days - b.age_days)
    return { submitted, approved, paid }
  }, [filtered])

  // Header KPIs computed off the *unfiltered* rows so the header
  // shows total exposure, not just what's matched by the filter.
  const kpis = useMemo(() => {
    const submitted = (rows || []).filter(r => r.status === 'submitted_pending_review')
    const approved  = (rows || []).filter(r => r.status === 'approved')
    return {
      reviewCount: submitted.length,
      reviewSum:   submitted.reduce((s, r) => s + r.grand_total, 0),
      payCount:    approved.length,
      paySum:      approved.reduce((s, r) => s + r.grand_total, 0),
      overdueCount: (rows || []).filter(r => r.age_days >= 7).length,
    }
  }, [rows])

  const active = useMemo(
    () => rows?.find(r => r.id === activeId) || null,
    [rows, activeId],
  )

  const togglePicked = (id: string) => {
    setPicked(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }
  const togglePickAllApproved = () => {
    const all = groupedFiltered.approved.map(r => r.id)
    const allOn = all.every(id => picked.has(id))
    setPicked(prev => {
      const n = new Set(prev)
      for (const id of all) {
        if (allOn) n.delete(id); else n.add(id)
      }
      return n
    })
  }

  const pickedApproved = groupedFiltered.approved.filter(r => picked.has(r.id))

  async function approveOne(rowId: string) {
    setBusyId(rowId)
    try {
      const r = await fetch(`/api/expense-reports/${rowId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        alert(`Approve failed: ${j.error || r.statusText}`)
        return
      }
      setRefreshTick(t => t + 1)
    } finally {
      setBusyId(null)
    }
  }

  // Opens the Mark-Paid modal for one row. The actual API call
  // happens in confirmPayModal once the operator enters the note
  // (or skips it).
  function openMarkPaidOne(row: QueueRow) {
    setPayModal({
      mode: 'single',
      ids: [row.id],
      label: `${row.buyer_name}${row.event_label ? ' · ' + row.event_label : ''}`,
    })
  }

  // Bulk version — same modal, multiple ids.
  function openBulkPay() {
    const ids = pickedApproved.map(r => r.id)
    if (ids.length === 0) { alert('Pick at least one Approved report.'); return }
    setPayModal({
      mode: 'bulk',
      ids,
      label: `${ids.length} report${ids.length === 1 ? '' : 's'}`,
    })
  }

  // Modal Save handler — fires the right endpoint per mode.
  async function confirmPayModal(paidNote: string) {
    if (!payModal) return
    const note = paidNote.trim()
    if (payModal.mode === 'single') {
      const rowId = payModal.ids[0]
      setBusyId(rowId); setPayModal(null)
      try {
        const r = await fetch(`/api/expense-reports/${rowId}/mark-paid`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
          body: JSON.stringify(note ? { paid_note: note } : {}),
        })
        if (!r.ok) {
          const j = await r.json().catch(() => ({}))
          alert(`Mark Paid failed: ${j.error || r.statusText}`)
          return
        }
        setRefreshTick(t => t + 1)
      } finally {
        setBusyId(null)
      }
    } else {
      setPaying(true); setPayResult(null); setPayModal(null)
      try {
        const r = await fetch('/api/accounting-hub/bulk-paid', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
          body: JSON.stringify({
            ids: payModal.ids,
            notify: notifyOnPay,
            ...(note ? { paid_note: note } : {}),
          }),
        })
        const j = await r.json()
        if (!r.ok) { alert(`Failed: ${j.error || r.statusText}`); return }
        setPayResult({ paid: j.paid || 0, emails: j.emails_sent || 0, failed: j.emails_failed || 0 })
        setPicked(new Set())
        setRefreshTick(t => t + 1)
      } finally {
        setPaying(false)
      }
    }
  }

  // Unmark-paid action — for paid reports the operator wants to
  // reset back to 'approved' (typo, payment bounced, need to
  // re-mark with a corrected note).
  async function unmarkPaid(rowId: string) {
    if (!confirm('Unmark as paid? This drops the report back to Approved and clears the paid date / note. You can re-mark it whenever the payment is recorded again.')) return
    setBusyId(rowId)
    try {
      const r = await fetch(`/api/expense-reports/${rowId}/unmark-paid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        alert(`Unmark Paid failed: ${j.error || r.statusText}`)
        return
      }
      setRefreshTick(t => t + 1)
    } finally {
      setBusyId(null)
    }
  }

  function openFullDetail(reportId: string) {
    if (!setNav) return
    setNav('expenses')
    setTimeout(() => window.dispatchEvent(
      new CustomEvent('beb:open-expense-report', { detail: { reportId } }),
    ), 0)
  }

  if (!isAllowed) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="card text-center" style={{ padding: 40 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
          <div className="font-bold" style={{ fontSize: 16 }}>Accounting access required</div>
          <div style={{ fontSize: 13, color: 'var(--mist)', marginTop: 6 }}>
            This dashboard is gated to the Accounting role.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={fullscreen
      ? {
          position: 'fixed', inset: 0, zIndex: 9000,
          background: 'var(--cream)',
          padding: 24, overflow: 'auto',
        }
      : { padding: 24, maxWidth: 1400, margin: '0 auto' }
    }>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0 }}>
          💼 Accounting Hub
          {fullscreen && (
            <span style={{ fontSize: 13, color: 'var(--mist)', fontWeight: 700, marginLeft: 8 }}>
              · Fullscreen · ESC to close
            </span>
          )}
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setFullscreen(f => !f)}
            className="btn-outline btn-sm"
            title={fullscreen ? 'Close fullscreen (ESC)' : 'Open in fullscreen — frees up ~280px from the sidebar'}
          >
            {fullscreen ? '✕ Close' : '⛶ Fullscreen'}
          </button>
          <button onClick={() => setRefreshTick(t => t + 1)} className="btn-outline btn-sm">↻ Refresh</button>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 14 }}>
        <KpiTile label="Awaiting review" count={kpis.reviewCount} amount={kpis.reviewSum} accent="#3B82F6" />
        <KpiTile label="Awaiting payment" count={kpis.payCount} amount={kpis.paySum} accent="#1D6B44" />
        <KpiTile label="Overdue (7+ days)" count={kpis.overdueCount} amount={null} accent={kpis.overdueCount > 0 ? '#B22234' : 'var(--mist)'} />
      </div>

      {/* W-9 panel — Send-W-9 modal + recent-history table. Lives
          above the expense queue since it's a fast everyday action. */}
      <W9Panel />

      {/* Filter bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, padding: 12, marginBottom: 14, background: '#fff', border: '1px solid var(--pearl)', borderRadius: 'var(--r)' }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="fl">Status</label>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusFilter)}>
            <option value="all">Active (default)</option>
            <option value="submitted_pending_review">Awaiting review</option>
            <option value="approved">Awaiting payment</option>
            <option value="paid">Paid (last 90 days)</option>
            <option value="all_incl_paid">All (incl. paid)</option>
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="fl">Brand</label>
          <select value={brandFilter} onChange={e => setBrandFilter(e.target.value as BrandFilter)}>
            <option value="all">All</option>
            <option value="beb">BEB</option>
            <option value="liberty">Liberty</option>
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="fl">Age</label>
          <select value={ageFilter} onChange={e => setAgeFilter(e.target.value as AgeFilter)}>
            <option value="all">All</option>
            <option value="overdue">Overdue (7+ days)</option>
            <option value="recent">Recent (&lt;7 days)</option>
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="fl">Search</label>
          <input type="search" placeholder="Buyer or event" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {err && <div style={{ background: '#FEE2E2', color: '#991B1B', padding: 10, borderRadius: 6, marginBottom: 10, fontSize: 13 }}>{err}</div>}

      {/* Two-pane body */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(420px, 1.2fr) minmax(380px, 1fr)', gap: 14, alignItems: 'start' }}>

        {/* LEFT — queue list */}
        <div>
          {/* Bulk action bar */}
          {pickedApproved.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 14px', marginBottom: 10, background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>
                {pickedApproved.length} selected · {fmtMoney(pickedApproved.reduce((s, r) => s + r.grand_total, 0), { cents: true })}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Checkbox
                  checked={notifyOnPay}
                  onChange={setNotifyOnPay}
                  label={<span style={{ fontSize: 12, color: 'var(--ash)' }}>Email submitters</span>}
                />
                <button onClick={openBulkPay} disabled={paying} className="btn-primary btn-sm">
                  {paying ? 'Paying…' : `💰 Mark ${pickedApproved.length} Paid`}
                </button>
              </div>
            </div>
          )}

          {payResult && (
            <div style={{ background: '#DCFCE7', border: '1px solid #86EFAC', padding: 10, borderRadius: 8, marginBottom: 10, fontSize: 13 }}>
              ✓ Paid {payResult.paid} · {payResult.emails} email{payResult.emails === 1 ? '' : 's'} sent{payResult.failed > 0 ? `, ${payResult.failed} failed` : ''}
            </div>
          )}

          {rows == null ? (
            <div style={{ padding: 20, color: 'var(--mist)', fontSize: 13 }}>Loading…</div>
          ) : (
            <>
              {/* Submitted group */}
              <QueueGroup
                title={`📥 Awaiting review (${groupedFiltered.submitted.length})`}
                rows={groupedFiltered.submitted}
                showBulkSelect={false}
                activeId={activeId}
                onSelect={setActiveId}
                picked={picked}
                onTogglePick={togglePicked}
              />
              {/* Approved group */}
              <QueueGroup
                title={`💰 Awaiting payment (${groupedFiltered.approved.length})`}
                rows={groupedFiltered.approved}
                showBulkSelect={true}
                allChecked={groupedFiltered.approved.length > 0 && groupedFiltered.approved.every(r => picked.has(r.id))}
                onToggleAll={togglePickAllApproved}
                activeId={activeId}
                onSelect={setActiveId}
                picked={picked}
                onTogglePick={togglePicked}
              />
              {/* Paid group — rendered when the operator opted in via
                  the status filter ('paid' or 'all_incl_paid'). Sorted
                  most-recently-paid first. */}
              <QueueGroup
                title={`✅ Paid (${groupedFiltered.paid.length})`}
                rows={groupedFiltered.paid}
                showBulkSelect={false}
                activeId={activeId}
                onSelect={setActiveId}
                picked={picked}
                onTogglePick={togglePicked}
              />

              {filtered.length === 0 && (
                <div style={{ padding: 30, textAlign: 'center', color: 'var(--mist)', background: '#fff', border: '1px solid var(--pearl)', borderRadius: 8 }}>
                  No reports match these filters. {(rows.length || 0) === 0 && '🎉 The queue is empty!'}
                </div>
              )}
            </>
          )}
        </div>

        {/* RIGHT — detail */}
        <div style={{ position: 'sticky', top: 16 }}>
          {active ? (
            <div style={{ background: '#fff', border: '1px solid var(--pearl)', borderRadius: 12, padding: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--mist)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '.04em' }}>
                    {active.status === 'submitted_pending_review'
                      ? 'Awaiting review'
                      : active.status === 'approved'
                        ? 'Awaiting payment'
                        : 'Paid'}
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 900, marginTop: 2 }}>{active.buyer_name}</div>
                  <div style={{ fontSize: 13, color: 'var(--ash)', marginTop: 2 }}>{active.event_label || '(no event)'}</div>
                </div>
                {active.status === 'paid' ? (
                  <span style={{
                    display: 'inline-block', fontSize: 10, fontWeight: 800,
                    padding: '2px 6px', borderRadius: 4,
                    background: '#DCFCE7', color: '#166534',
                    letterSpacing: '.02em',
                  }}>
                    Paid {active.age_days === 0 ? 'today' : `${active.age_days}d ago`}
                  </span>
                ) : (
                  <span style={{ ...ageBadgeStyle(ageColor(active.age_days)) }}>{active.age_days} day{active.age_days === 1 ? '' : 's'}</span>
                )}
              </div>

              {/* Payment audit panel — only for paid reports. Shows
                  WHO paid + WHEN + the free-text 'how it was paid'
                  note (if any). */}
              {active.status === 'paid' && (
                <div style={{
                  background: '#F0FDF4', border: '1px solid #BBF7D0',
                  borderRadius: 8, padding: '10px 12px', marginBottom: 12,
                }}>
                  <div style={{ fontSize: 11, color: '#166534', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>
                    ✓ Payment recorded
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink)' }}>
                    {active.paid_by_name && <>By <b>{active.paid_by_name}</b> · </>}
                    {active.paid_at && new Date(active.paid_at).toLocaleDateString()}
                  </div>
                  {active.paid_note && (
                    <div style={{
                      marginTop: 6, padding: '6px 8px',
                      background: '#fff', border: '1px solid #BBF7D0', borderRadius: 6,
                      fontSize: 12, color: 'var(--ink)',
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    }}>
                      {active.paid_note}
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginTop: 12, marginBottom: 14 }}>
                <DetailRow label="Expenses" value={fmtMoney(active.total_expenses, { cents: true })} />
                <DetailRow label="Comp" value={fmtMoney(active.total_compensation, { cents: true })} />
                {active.total_bonus > 0 && (
                  <DetailRow label="Bonus" value={fmtMoney(active.total_bonus, { cents: true })} />
                )}
                <DetailRow label="Receipts" value={`${active.receipt_count}`} />
                <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--cream2)', paddingTop: 6 }}>
                  <DetailRow label="Grand Total" value={fmtMoney(active.grand_total, { cents: true })} bold />
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {active.status === 'submitted_pending_review' && (
                  <button
                    onClick={() => approveOne(active.id)}
                    disabled={busyId === active.id}
                    className="btn-primary"
                  >
                    {busyId === active.id ? 'Approving…' : '✓ Approve'}
                  </button>
                )}
                {active.status === 'approved' && (
                  <button
                    onClick={() => openMarkPaidOne(active)}
                    disabled={busyId === active.id}
                    className="btn-primary"
                  >
                    {busyId === active.id ? 'Marking…' : '💰 Mark Paid…'}
                  </button>
                )}
                {active.status === 'paid' && (
                  <button
                    onClick={() => unmarkPaid(active.id)}
                    disabled={busyId === active.id}
                    className="btn-outline"
                  >
                    {busyId === active.id ? 'Unmarking…' : '↺ Unmark Paid'}
                  </button>
                )}
                <button onClick={() => openFullDetail(active.id)} className="btn-outline">
                  Open full report →
                </button>

                {/* QuickBooks export — IIF (QBD) + CSV (QBO). Mapping
                    is set under Settings → 💼 QuickBooks Account
                    Mapping. We mark the report exported on the server
                    and show an "Exported ✓" hint here so Diane doesn't
                    double-book the same Bill. */}
                <ExportToQbButtons row={active} onExported={() => setRefreshTick(t => t + 1)} />
              </div>

              <div style={{ marginTop: 12, fontSize: 11, color: 'var(--mist)' }}>
                {active.submitted_at && <>Submitted {new Date(active.submitted_at).toLocaleDateString()}</>}
                {active.approved_at && <> · Approved {new Date(active.approved_at).toLocaleDateString()}</>}
                {active.paid_at && <> · Paid {new Date(active.paid_at).toLocaleDateString()}</>}
              </div>
            </div>
          ) : (
            <div style={{ background: '#fff', border: '1px dashed var(--pearl)', borderRadius: 12, padding: 30, textAlign: 'center', color: 'var(--mist)', fontSize: 13 }}>
              ← Pick a report on the left to see the details and act on it.
            </div>
          )}
        </div>
      </div>

      {/* Mark-Paid modal — captures the optional 'how was it paid'
          note for single + bulk paths. */}
      {payModal && (
        <MarkPaidModal
          mode={payModal.mode}
          label={payModal.label}
          notifyOnPay={notifyOnPay}
          onNotifyChange={setNotifyOnPay}
          onCancel={() => setPayModal(null)}
          onSave={confirmPayModal}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Mark-Paid modal
// ─────────────────────────────────────────────────────────────
// Optional free-text note about HOW the report was paid. Same
// modal serves the single-row and bulk paths. The bulk path also
// shows the "email submitters" checkbox so it can be toggled at
// the same moment.

interface MarkPaidModalProps {
  mode: 'single' | 'bulk'
  label: string
  notifyOnPay: boolean
  onNotifyChange: (v: boolean) => void
  onCancel: () => void
  onSave: (note: string) => void
}

function MarkPaidModal({ mode, label, notifyOnPay, onNotifyChange, onCancel, onSave }: MarkPaidModalProps) {
  const [note, setNote] = useState('')

  // ESC dismiss for parity with the FullscreenWorkspace convention.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 9100,
        background: 'rgba(0,0,0,.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 12, padding: 20,
          width: '100%', maxWidth: 480,
          boxShadow: '0 12px 40px rgba(0,0,0,.25)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <h3 style={{ fontSize: 16, fontWeight: 900, margin: 0 }}>💰 Mark Paid</h3>
          <button onClick={onCancel} aria-label="Close" style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontSize: 22, color: 'var(--mist)', lineHeight: 1,
          }}>×</button>
        </div>
        <div style={{ fontSize: 13, color: 'var(--ash)', marginBottom: 14 }}>
          {mode === 'single' ? <>Marking <b>{label}</b> as paid.</> : <>Marking <b>{label}</b> as paid.</>}
        </div>

        <label style={{ display: 'block', marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>
            How was it paid? <span style={{ fontWeight: 600, color: 'var(--mist)', textTransform: 'none' }}>(optional)</span>
          </div>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="e.g. Check #1234 · Wire 5/14 · Zelle to 330-555-0101 · ACH batch 2026-05-14"
            rows={3}
            maxLength={500}
            style={{
              width: '100%', padding: '8px 10px', fontSize: 13,
              fontFamily: 'inherit',
              border: '1px solid var(--pearl)', borderRadius: 6, background: '#fff',
              resize: 'vertical',
            }}
            autoFocus
          />
          <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 4 }}>
            {mode === 'bulk'
              ? <>Applied to all selected reports. Per-report notes can still be edited individually after.</>
              : <>Visible on the report's detail panel + payment audit trail.</>}
          </div>
        </label>

        {mode === 'bulk' && (
          <div style={{ marginBottom: 14 }}>
            <Checkbox
              checked={notifyOnPay}
              onChange={onNotifyChange}
              label={<span style={{ fontSize: 12, color: 'var(--ash)' }}>Email submitters that their report was paid</span>}
            />
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} className="btn-outline btn-sm">Cancel</button>
          <button onClick={() => onSave(note)} className="btn-primary btn-sm">
            💰 Mark Paid
          </button>
        </div>
      </div>
    </div>
  )
}

function KpiTile({ label, count, amount, accent }: { label: string; count: number; amount: number | null; accent: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid var(--pearl)', borderRadius: 10, padding: '14px 16px', borderLeft: `4px solid ${accent}` }}>
      <div style={{ fontSize: 11, color: 'var(--mist)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '.04em' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
        <div style={{ fontSize: 22, fontWeight: 900, color: accent }}>{count}</div>
        {amount != null && <div style={{ fontSize: 13, color: 'var(--ash)', fontWeight: 700 }}>· {fmtMoney(amount, { cents: false })}</div>}
      </div>
    </div>
  )
}

interface QueueGroupProps {
  title: string
  rows: QueueRow[]
  showBulkSelect: boolean
  allChecked?: boolean
  onToggleAll?: () => void
  activeId: string | null
  onSelect: (id: string) => void
  picked: Set<string>
  onTogglePick: (id: string) => void
}

function QueueGroup({ title, rows, showBulkSelect, allChecked, onToggleAll, activeId, onSelect, picked, onTogglePick }: QueueGroupProps) {
  if (rows.length === 0) return null
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6, padding: '0 4px' }}>
        {showBulkSelect && (
          <Checkbox
            checked={!!allChecked}
            onChange={() => onToggleAll?.()}
            size={16}
          />
        )}
        <span>{title}</span>
      </div>
      <div style={{ background: '#fff', border: '1px solid var(--pearl)', borderRadius: 8, overflow: 'hidden' }}>
        {rows.map((r, i) => {
          const isActive = activeId === r.id
          const ag = ageColor(r.age_days)
          return (
            <div
              key={r.id}
              onClick={() => onSelect(r.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px',
                borderTop: i === 0 ? 'none' : '1px solid var(--cream2)',
                background: isActive ? 'var(--green-pale)' : 'transparent',
                cursor: 'pointer',
              }}
            >
              {showBulkSelect && (
                <div onClick={e => e.stopPropagation()}>
                  <Checkbox
                    checked={picked.has(r.id)}
                    onChange={() => onTogglePick(r.id)}
                    size={16}
                  />
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.buyer_name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--mist)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.event_label || '—'}{r.brand ? ` · ${r.brand.toUpperCase()}` : ''}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>{fmtMoney(r.grand_total, { cents: false })}</div>
                <div style={{ marginTop: 2 }}>
                  <span style={ageBadgeStyle(ag)}>{ag.label}</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DetailRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontSize: bold ? 18 : 14, fontWeight: bold ? 900 : 700, color: 'var(--ink)', marginTop: 2 }}>{value}</div>
    </div>
  )
}

function ageBadgeStyle(c: { bg: string; fg: string }): React.CSSProperties {
  return {
    display: 'inline-block',
    fontSize: 10, fontWeight: 800,
    padding: '2px 6px', borderRadius: 4,
    background: c.bg, color: c.fg,
    letterSpacing: '.02em',
  }
}

/**
 * Per-report QuickBooks export controls. Two side-by-side buttons
 * — IIF for QBD, CSV for QBO — that POST to
 * /api/expense-reports/[id]/export-quickbooks, stream the file
 * back, trigger a download, and refresh the queue so the
 * exported_to_qb_at pill appears.
 *
 * If the report has already been exported, the "Exported ✓" pill
 * shows above the buttons and clicking either button asks the user
 * to confirm re-export (so Diane doesn't accidentally re-book a
 * Bill she already imported into QB).
 */
function ExportToQbButtons({
  row, onExported,
}: { row: QueueRow; onExported: () => void }) {
  const [busy, setBusy] = useState<'iif' | 'csv' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function exportAs(format: 'iif' | 'csv') {
    if (busy) return
    if (row.exported_to_qb_at) {
      const prior = row.exported_to_qb_format
        ? `(last exported as ${row.exported_to_qb_format.toUpperCase()} on ${new Date(row.exported_to_qb_at).toLocaleDateString()})`
        : ''
      if (!confirm(`This report was already exported to QuickBooks ${prior}. Re-exporting will produce a fresh file but the Bill in QB stays unchanged. Continue?`)) return
    }
    setBusy(format); setError(null)
    try {
      const headers = await authHeaders()
      const res = await fetch(`/api/expense-reports/${row.id}/export-quickbooks?format=${format}`, {
        method: 'POST',
        headers,
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({} as any))
        throw new Error(j.error || `HTTP ${res.status}`)
      }
      // Stream → blob → click hidden <a> to download.
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${row.report_number || row.id.slice(0, 8)}.${format}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      onExported()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
      {row.exported_to_qb_at && (
        <div style={{
          fontSize: 11, fontWeight: 700, color: '#166534',
          background: '#DCFCE7', borderRadius: 4, padding: '4px 8px',
          alignSelf: 'flex-start',
        }}>
          ✓ Exported to QB · {row.exported_to_qb_format?.toUpperCase() || ''} · {new Date(row.exported_to_qb_at).toLocaleDateString()}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={() => exportAs('iif')}
          disabled={!!busy}
          className="btn-outline btn-sm"
          style={{ flex: 1 }}
          title="QuickBooks Desktop — drop the .iif into QB → File → Utilities → Import → IIF Files"
        >
          {busy === 'iif' ? 'Building…' : '⬇ IIF (QBD)'}
        </button>
        <button
          onClick={() => exportAs('csv')}
          disabled={!!busy}
          className="btn-outline btn-sm"
          style={{ flex: 1 }}
          title="QuickBooks Online — feed the .csv to SaasAnt / Transaction Pro / Spreadsheet Sync"
        >
          {busy === 'csv' ? 'Building…' : '⬇ CSV (QBO)'}
        </button>
      </div>
      {error && (
        <div style={{ fontSize: 11, color: '#991B1B', background: '#FEE2E2', borderRadius: 4, padding: '4px 8px' }}>
          ⚠ {error}
        </div>
      )}
    </div>
  )
}
