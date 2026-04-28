'use client'

// Expense report list. Buyers see their own reports; admin/superadmin
// see all (RLS enforces). New reports are created by picking from the
// user's events — once the Travel module integration ships in PR5, the
// "+ New Report" button will fall back to this picker only for events
// that don't already auto-create a report.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type { Event, ExpenseReport, ExpenseReportStatus, User } from '@/types'
import {
  STATUS_LABEL, STATUS_COLOR,
  formatCurrency, formatDateLong,
} from './expensesUtils'

interface ReportRow extends ExpenseReport {
  event_name: string
  event_start: string
  user_name: string
}

const STATUS_FILTERS: { id: 'all' | ExpenseReportStatus; label: string }[] = [
  { id: 'all',                      label: 'All' },
  { id: 'active',                   label: 'Active' },
  { id: 'submitted_pending_review', label: 'Pending review' },
  { id: 'approved',                 label: 'Approved' },
  { id: 'paid',                     label: 'Paid' },
]

export default function ExpensesList({ onOpen }: { onOpen: (reportId: string) => void }) {
  const { user, events } = useApp()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'

  const [rows, setRows] = useState<ReportRow[]>([])
  const [users, setUsers] = useState<Pick<User, 'id' | 'name'>[]>([])
  const [loaded, setLoaded] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | ExpenseReportStatus>('all')
  const [userFilter, setUserFilter] = useState<string>('all')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    if (!user) return
    setError(null)
    const { data: reports, error: reportsErr } = await supabase
      .from('expense_reports')
      .select('*')
      .order('created_at', { ascending: false })
    if (reportsErr) {
      setError(reportsErr.message)
      setLoaded(true)
      return
    }
    const reportsArr = (reports ?? []) as ExpenseReport[]

    // Decorate with event + user names. Events are already in context;
    // users are loaded separately so the admin filter dropdown can show
    // names even for owners not already in the events graph.
    const eventById = new Map(events.map(e => [e.id, e]))
    const userIds = Array.from(new Set(reportsArr.map(r => r.user_id)))
    let userMap = new Map<string, string>()
    if (userIds.length > 0) {
      const { data: usersRows } = await supabase
        .from('users').select('id, name').in('id', userIds)
      userMap = new Map((usersRows ?? []).map((u: any) => [u.id, u.name]))
      setUsers((usersRows ?? []) as any)
    }
    setRows(reportsArr.map(r => ({
      ...r,
      event_name:  eventById.get(r.event_id)?.store_name ?? '(unknown event)',
      event_start: eventById.get(r.event_id)?.start_date ?? '',
      user_name:   userMap.get(r.user_id) ?? '',
    })))
    setLoaded(true)
  }
  useEffect(() => { reload() /* eslint-disable-next-line */ }, [user?.id, events.length])

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (isAdmin && userFilter !== 'all' && r.user_id !== userFilter) return false
      return true
    })
  }, [rows, statusFilter, userFilter, isAdmin])

  // For the new-report picker: events the user can see, minus events
  // that already have a report for this user.
  const eligibleEvents = useMemo(() => {
    if (!user) return []
    const ownReportEventIds = new Set(rows.filter(r => r.user_id === user.id).map(r => r.event_id))
    return events
      .filter(e => !ownReportEventIds.has(e.id))
      .sort((a, b) => b.start_date.localeCompare(a.start_date))
  }, [events, rows, user?.id])

  async function createReportForEvent(ev: Event) {
    if (!user) return
    setCreating(true); setError(null)
    // If RLS rejects the insert, surface the error inline.
    const { data, error: insertErr } = await supabase
      .from('expense_reports')
      .insert({ event_id: ev.id, user_id: user.id })
      .select('id')
      .single()
    setCreating(false)
    if (insertErr || !data) {
      setError(insertErr?.message ?? 'Could not create report.')
      return
    }
    setPickerOpen(false)
    await reload()
    onOpen(data.id)
  }

  return (
    <div className="p-6" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)' }}>💵 Expenses</h1>
        <button className="btn-primary btn-sm" onClick={() => setPickerOpen(true)}>+ New Report</button>
      </div>

      {/* Filter bar */}
      <div className="card" style={{ marginBottom: 12, padding: 12 }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: isAdmin ? 'minmax(180px,1fr) minmax(200px,1fr)' : 'minmax(180px,1fr)',
          gap: 10,
        }}>
          <div>
            <label className="fl">Status</label>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}>
              {STATUS_FILTERS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          {isAdmin && (
            <div>
              <label className="fl">User</label>
              <select value={userFilter} onChange={e => setUserFilter(e.target.value)} style={{ width: '100%' }}>
                <option value="all">All users</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div style={{ padding: 10, marginBottom: 10, background: '#FEE2E2', color: '#991B1B', borderRadius: 6, fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--cream2)', borderBottom: '2px solid var(--pearl)' }}>
                {['Event', 'Date', isAdmin ? 'User' : '', 'Status', 'Total', ''].filter(Boolean).map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!loaded ? (
                <tr><td colSpan={isAdmin ? 6 : 5} style={{ padding: 30, textAlign: 'center', color: 'var(--mist)' }}>Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={isAdmin ? 6 : 5} style={{ padding: 30, textAlign: 'center', color: 'var(--mist)' }}>
                  {rows.length === 0 ? 'No reports yet — create one with "+ New Report".' : 'No reports match the current filters.'}
                </td></tr>
              ) : filtered.map(r => {
                const sc = STATUS_COLOR[r.status]
                return (
                  <tr key={r.id}
                    onClick={() => onOpen(r.id)}
                    style={{ borderBottom: '1px solid var(--cream2)', cursor: 'pointer' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--cream2)')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}>
                    <td style={{ padding: '10px 12px', fontWeight: 700, color: 'var(--ink)' }}>{r.event_name}</td>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', color: 'var(--ash)' }}>
                      {r.event_start ? formatDateLong(r.event_start) : '—'}
                    </td>
                    {isAdmin && <td style={{ padding: '10px 12px', color: 'var(--ash)' }}>{r.user_name}</td>}
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{
                        background: sc.bg, color: sc.fg,
                        padding: '2px 10px', borderRadius: 999,
                        fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap',
                      }}>{STATUS_LABEL[r.status]}</span>
                    </td>
                    <td style={{ padding: '10px 12px', fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap' }}>
                      {formatCurrency(r.grand_total)}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      <button onClick={e => { e.stopPropagation(); onOpen(r.id) }}
                        className="btn-outline btn-sm">Open →</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* New-report picker */}
      {pickerOpen && (
        <div onClick={e => e.target === e.currentTarget && setPickerOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ width: 'min(560px, 100%)', maxHeight: '80vh', overflowY: 'auto', background: 'var(--cream)', borderRadius: 12, padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>Pick an event</h2>
              <button onClick={() => setPickerOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--mist)' }}>×</button>
            </div>
            {eligibleEvents.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--mist)' }}>
                No events without a report. Create an event first, or open an existing report from the list.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {eligibleEvents.map(ev => (
                  <button key={ev.id} disabled={creating}
                    onClick={() => createReportForEvent(ev)}
                    style={{
                      textAlign: 'left', padding: '12px 14px', borderRadius: 8,
                      background: '#fff', border: '1px solid var(--cream2)', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      fontFamily: 'inherit',
                    }}>
                    <div>
                      <div style={{ fontWeight: 800, color: 'var(--ink)' }}>{ev.store_name}</div>
                      <div style={{ fontSize: 12, color: 'var(--mist)' }}>{formatDateLong(ev.start_date)}</div>
                    </div>
                    <span style={{ color: 'var(--green)', fontWeight: 700 }}>+ Create</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
