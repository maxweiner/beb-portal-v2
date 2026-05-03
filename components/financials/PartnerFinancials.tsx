'use client'

// Partner-only reconciliation dashboard. Pulls every expense_report,
// applies the active filters in JS (volumes are small — tens of
// reports per year), and summarises four ways:
//   1. Top stat cards: pending approvals + paid YTD reimbursements,
//      paid YTD compensation, # of paid events YTD.
//   2. Quarterly breakdown table for the filtered window.
//   3. Per-buyer breakdown table for the filtered window.
//   4. Pending approvals list with click-through to the report
//      (mirrors PendingApprovalsModal but always-on, no dismiss).
//
// All RLS already permits partners (admin/superadmin) to read every
// row, so this is a single fetch + client-side aggregation.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type { ExpenseReport, ExpenseReportStatus, User } from '@/types'
import { STATUS_LABEL, STATUS_COLOR, formatCurrency, formatDateLong } from '@/components/expenses/expensesUtils'
import DatePicker from '@/components/ui/DatePicker'

const STATUS_OPTIONS: { id: 'all' | ExpenseReportStatus; label: string }[] = [
  { id: 'all',                      label: 'All' },
  { id: 'active',                   label: 'Active' },
  { id: 'submitted_pending_review', label: 'Pending review' },
  { id: 'approved',                 label: 'Approved' },
  { id: 'paid',                     label: 'Paid' },
]

interface DecoratedReport extends ExpenseReport {
  user_name: string
  event_name: string
  event_start: string
}

function startOfYearIso(): string {
  return `${new Date().getFullYear()}-01-01`
}
function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function quarter(iso: string | null | undefined): 1 | 2 | 3 | 4 | null {
  if (!iso) return null
  const m = Number(iso.slice(5, 7))
  if (m >= 1 && m <= 3) return 1
  if (m >= 4 && m <= 6) return 2
  if (m >= 7 && m <= 9) return 3
  if (m >= 10 && m <= 12) return 4
  return null
}

export default function PartnerFinancials({ onOpenReport }: { onOpenReport: (reportId: string) => void }) {
  const { user, events } = useApp()
  const isPartner = !!user?.is_partner

  const [rows, setRows] = useState<DecoratedReport[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [from, setFrom] = useState<string>(startOfYearIso())
  const [to, setTo] = useState<string>(todayIso())
  const [userFilter, setUserFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | ExpenseReportStatus>('all')
  const [users, setUsers] = useState<Pick<User, 'id' | 'name'>[]>([])

  useEffect(() => {
    if (!isPartner) { setLoaded(true); return }
    let cancelled = false

    const load = async () => {
      setError(null)
      const { data: reports, error: rErr } = await supabase
        .from('expense_reports').select('*').order('created_at', { ascending: false })
      if (cancelled) return
      if (rErr) { setError(rErr.message); setLoaded(true); return }
      const reportsArr = (reports ?? []) as ExpenseReport[]

      const eventById = new Map(events.map(e => [e.id, e]))
      const userIds = Array.from(new Set(reportsArr.map(r => r.user_id)))
      let userMap = new Map<string, string>()
      if (userIds.length > 0) {
        const { data: usersRows } = await supabase.from('users').select('id, name').in('id', userIds)
        userMap = new Map((usersRows ?? []).map((u: any) => [u.id, u.name]))
        setUsers((usersRows ?? []) as any)
      }
      if (cancelled) return
      setRows(reportsArr.map(r => ({
        ...r,
        user_name:   userMap.get(r.user_id) ?? '',
        event_name:  eventById.get(r.event_id)?.store_name ?? '(unknown event)',
        event_start: eventById.get(r.event_id)?.start_date ?? '',
      })))
      setLoaded(true)
    }
    load()

    const onChange = () => load()
    window.addEventListener('beb:expense-status-changed', onChange)
    return () => { cancelled = true; window.removeEventListener('beb:expense-status-changed', onChange) }
  }, [isPartner, events.length, user?.id])

  /** Reports inside the selected user filter. The window-aware filters
   *  apply per panel — not all panels use the same date column. */
  const userScoped = useMemo(() => {
    return rows.filter(r => userFilter === 'all' || r.user_id === userFilter)
  }, [rows, userFilter])

  /** "Paid in window" — driven by paid_at. Used for reimbursement /
   *  compensation totals and the per-buyer + quarterly breakdowns. */
  const paidInWindow = useMemo(() => {
    return userScoped.filter(r => {
      if (r.status !== 'paid') return false
      const at = (r.paid_at ?? '').slice(0, 10)
      if (!at) return false
      return at >= from && at <= to
    })
  }, [userScoped, from, to])

  /** Pending approvals — never date-filtered (you want to see them all). */
  const pending = useMemo(() => userScoped.filter(r => r.status === 'submitted_pending_review'), [userScoped])

  /** Listing panel — driven by status filter + the date range applied
   *  to whichever timestamp matches the status. */
  const listed = useMemo(() => {
    return userScoped.filter(r => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      const stamp =
        r.status === 'paid'                     ? r.paid_at
        : r.status === 'approved'               ? r.approved_at
        : r.status === 'submitted_pending_review' ? r.submitted_at
        : r.created_at
      const at = (stamp ?? '').slice(0, 10)
      if (!at) return false
      return at >= from && at <= to
    }).sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
  }, [userScoped, statusFilter, from, to])

  // Top KPIs
  const reimbursementsPaid = paidInWindow.reduce((s, r) => s + Number(r.total_expenses || 0), 0)
  const compensationPaid   = paidInWindow.reduce((s, r) => s + Number(r.total_compensation || r.comp_rate || 0), 0)
  const paidEvents         = new Set(paidInWindow.map(r => r.event_id)).size

  // Per-buyer breakdown (paid-in-window)
  const perBuyer = useMemo(() => {
    const m = new Map<string, { name: string; reimb: number; comp: number; events: Set<string> }>()
    for (const r of paidInWindow) {
      const k = r.user_id
      if (!m.has(k)) m.set(k, { name: r.user_name || '(unknown)', reimb: 0, comp: 0, events: new Set() })
      const row = m.get(k)!
      row.reimb += Number(r.total_expenses || 0)
      row.comp  += Number(r.total_compensation || r.comp_rate || 0)
      row.events.add(r.event_id)
    }
    return [...m.entries()]
      .map(([id, v]) => ({ id, name: v.name, reimb: v.reimb, comp: v.comp, events: v.events.size, total: v.reimb + v.comp }))
      .sort((a, b) => b.total - a.total)
  }, [paidInWindow])

  // Quarterly breakdown (paid-in-window, by quarter of paid_at)
  const perQuarter = useMemo(() => {
    const q: Record<1 | 2 | 3 | 4, { reimb: number; comp: number; events: Set<string> }> = {
      1: { reimb: 0, comp: 0, events: new Set() },
      2: { reimb: 0, comp: 0, events: new Set() },
      3: { reimb: 0, comp: 0, events: new Set() },
      4: { reimb: 0, comp: 0, events: new Set() },
    }
    for (const r of paidInWindow) {
      const qn = quarter(r.paid_at)
      if (!qn) continue
      q[qn].reimb += Number(r.total_expenses || 0)
      q[qn].comp  += Number(r.total_compensation || r.comp_rate || 0)
      q[qn].events.add(r.event_id)
    }
    return ([1, 2, 3, 4] as const).map(qn => ({
      q: qn,
      reimb: q[qn].reimb,
      comp:  q[qn].comp,
      events: q[qn].events.size,
      total: q[qn].reimb + q[qn].comp,
    }))
  }, [paidInWindow])

  if (!isPartner) {
    return (
      <div className="p-6" style={{ maxWidth: 720, margin: '0 auto' }}>
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--mist)' }}>
          Financials is partner-only. If you should have access, ask Max / Joe / Rich to set <code>users.is_partner = true</code> on your account.
        </div>
      </div>
    )
  }

  return (
    <div className="p-6" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)', marginBottom: 14 }}>
        💼 Financials · {new Date().getFullYear()}
      </h1>

      {/* Filters */}
      <div className="card" style={{ marginBottom: 12, padding: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
          <div>
            <label className="fl">From</label>
            <DatePicker value={from} onChange={setFrom} max={to} />
          </div>
          <div>
            <label className="fl">To</label>
            <DatePicker value={to} onChange={setTo} min={from} />
          </div>
          <div>
            <label className="fl">User</label>
            <select value={userFilter} onChange={e => setUserFilter(e.target.value)}>
              <option value="all">All users</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label className="fl">Status (list below)</label>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}>
              {STATUS_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {error && (
        <div style={{ padding: 10, marginBottom: 10, background: '#FEE2E2', color: '#991B1B', borderRadius: 6, fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 14 }}>
        <Kpi label="Pending approvals" value={pending.length.toString()} accent="#F59E0B" />
        <Kpi label="Reimbursements paid" value={formatCurrency(reimbursementsPaid)} accent="#1D6B44" />
        <Kpi label="Compensation paid" value={formatCurrency(compensationPaid)} accent="#1E40AF" />
        <Kpi label="Paid events" value={paidEvents.toString()} accent="#7C3AED" />
      </div>

      {/* Pending approvals list */}
      <div className="card" style={{ padding: 12, marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)', marginBottom: 10 }}>
          ⚠️ Pending your review {pending.length > 0 ? `(${pending.length})` : ''}
        </div>
        {pending.length === 0 ? (
          <div style={{ padding: 12, color: 'var(--mist)', fontStyle: 'italic', fontSize: 13 }}>None — you're caught up.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pending.map(r => (
              <button key={r.id}
                onClick={() => onOpenReport(r.id)}
                style={{
                  textAlign: 'left', padding: '10px 12px', borderRadius: 8,
                  background: '#fff', border: '1px solid var(--cream2)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  fontFamily: 'inherit',
                }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800, color: 'var(--ink)' }}>{r.user_name} · {r.event_name}</div>
                  <div style={{ fontSize: 12, color: 'var(--mist)' }}>
                    {r.event_start && `Event ${formatDateLong(r.event_start)}`}
                    {r.submitted_at && ` · submitted ${new Date(r.submitted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                  </div>
                </div>
                <div style={{ fontWeight: 800, color: 'var(--ink)' }}>{formatCurrency(r.grand_total)}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Two-column lower grid: quarterly + per-buyer */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 14, marginBottom: 14 }}>
        <div className="card" style={{ padding: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)', marginBottom: 8 }}>
            By quarter — paid {fromYearLabel(from, to)}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--cream2)' }}>
                <Th>Q</Th><Th align="right">Reimb</Th><Th align="right">Comp</Th><Th align="right">Events</Th><Th align="right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {perQuarter.map(r => (
                <tr key={r.q} style={{ borderBottom: '1px solid var(--cream2)' }}>
                  <Td>Q{r.q}</Td>
                  <Td align="right">{formatCurrency(r.reimb)}</Td>
                  <Td align="right">{formatCurrency(r.comp)}</Td>
                  <Td align="right">{r.events}</Td>
                  <Td align="right" bold>{formatCurrency(r.total)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card" style={{ padding: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)', marginBottom: 8 }}>
            By buyer — paid in window
          </div>
          {perBuyer.length === 0 ? (
            <div style={{ padding: 12, color: 'var(--mist)', fontStyle: 'italic', fontSize: 13 }}>No paid reports in this window.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--cream2)' }}>
                  <Th>Buyer</Th><Th align="right">Reimb</Th><Th align="right">Comp</Th><Th align="right">Events</Th><Th align="right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {perBuyer.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--cream2)' }}>
                    <Td>{r.name}</Td>
                    <Td align="right">{formatCurrency(r.reimb)}</Td>
                    <Td align="right">{formatCurrency(r.comp)}</Td>
                    <Td align="right">{r.events}</Td>
                    <Td align="right" bold>{formatCurrency(r.total)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Filtered list */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: 12, borderBottom: '1px solid var(--cream2)', fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>
          Reports in window — {STATUS_OPTIONS.find(s => s.id === statusFilter)?.label.toLowerCase()}
          <span style={{ color: 'var(--mist)', fontWeight: 600, marginLeft: 6 }}>({listed.length})</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--cream2)' }}>
                <Th>Event</Th><Th>Buyer</Th><Th>Status</Th><Th align="right">Reimb</Th><Th align="right">Comp</Th><Th align="right">Total</Th><Th></Th>
              </tr>
            </thead>
            <tbody>
              {!loaded ? (
                <tr><td colSpan={7} style={{ padding: 30, textAlign: 'center', color: 'var(--mist)' }}>Loading…</td></tr>
              ) : listed.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: 30, textAlign: 'center', color: 'var(--mist)' }}>No reports match.</td></tr>
              ) : listed.map(r => {
                const sc = STATUS_COLOR[r.status]
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--cream2)', cursor: 'pointer' }}
                    onClick={() => onOpenReport(r.id)}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--cream2)')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}>
                    <Td>{r.event_name} {r.event_start && <span style={{ color: 'var(--mist)', fontSize: 11 }}>· {formatDateLong(r.event_start)}</span>}</Td>
                    <Td>{r.user_name}</Td>
                    <Td>
                      <span style={{ background: sc.bg, color: sc.fg, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 800 }}>
                        {STATUS_LABEL[r.status]}
                      </span>
                    </Td>
                    <Td align="right">{formatCurrency(r.total_expenses)}</Td>
                    <Td align="right">{formatCurrency(r.total_compensation || r.comp_rate || 0)}</Td>
                    <Td align="right" bold>{formatCurrency(r.grand_total)}</Td>
                    <Td align="right"><button className="btn-outline btn-xs" onClick={e => { e.stopPropagation(); onOpenReport(r.id) }}>Open →</button></Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function fromYearLabel(from: string, to: string): string {
  const fy = from.slice(0, 4), ty = to.slice(0, 4)
  return fy === ty ? fy : `${fy}–${ty}`
}

function Kpi({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="card" style={{ padding: 14, borderLeft: `4px solid ${accent}` }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)', marginTop: 4 }}>{value}</div>
    </div>
  )
}

function Th({ children, align = 'left' }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
  return <th style={{ padding: '8px 10px', textAlign: align, fontSize: 11, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{children}</th>
}
function Td({ children, align = 'left', bold }: { children?: React.ReactNode; align?: 'left' | 'right'; bold?: boolean }) {
  return <td style={{ padding: '8px 10px', textAlign: align, color: 'var(--ink)', fontWeight: bold ? 800 : 500 }}>{children}</td>
}
