'use client'

// Expense report list. Every user — including regular admins — sees
// only their own reports. Superadmins see all reports and get a "User"
// dropdown to filter. RLS still allows admins to read all rows
// server-side; the narrowing here is purely client-side display.
// New reports are created by picking from the user's events — once the
// Travel module integration ships in PR5, the "+ New Report" button
// will fall back to this picker only for events that don't already
// auto-create a report.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useIsNarrow } from './useIsNarrow'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import { isWorkerAssigned } from '@/lib/permissions'
import type { Event, ExpenseReport, ExpenseReportStatus, ExpenseReportTemplate, User } from '@/types'
import {
  STATUS_LABEL, STATUS_COLOR,
  formatCurrency, formatDateLong,
} from './expensesUtils'

interface ReportRow extends ExpenseReport {
  event_name: string
  event_start: string
  user_name: string
  /** 'buying' | 'trunk' | 'trade' — sales-side reports use the
   *  same row shape but reference trunk_show_id / trade_show_id
   *  instead of event_id. Display strips the prefix when 'buying'. */
  parent_kind: 'buying' | 'trunk' | 'trade' | 'unknown'
}

interface SalesParent {
  id: string
  start_date: string
  end_date: string
  label: string
}

const STATUS_FILTERS: { id: 'all' | ExpenseReportStatus; label: string }[] = [
  { id: 'all',                      label: 'All' },
  { id: 'active',                   label: 'Non-Submitted' },
  { id: 'submitted_pending_review', label: 'Pending review' },
  { id: 'approved',                 label: 'Approved' },
  { id: 'paid',                     label: 'Paid' },
]

// Accounting role doesn't need to see drafts ("active") — those are
// reports the buyer hasn't acted on yet. Strip from list + filter.
const STATUS_FILTERS_ACCOUNTING = STATUS_FILTERS.filter(s => s.id !== 'active')

export default function ExpensesList({ onOpen }: { onOpen: (reportId: string) => void }) {
  const { user, events, stores } = useApp()
  // Regular admins still see only their own reports. Superadmins and
  // accounting users get the cross-user view + "User" dropdown filter
  // — accounting needs all reports for AP processing, RLS now permits it.
  const canSeeAll = user?.role === 'superadmin' || user?.role === 'accounting'
  const isAccounting = user?.role === 'accounting'
  const isNarrow = useIsNarrow()

  const [rows, setRows] = useState<ReportRow[]>([])
  const [users, setUsers] = useState<Pick<User, 'id' | 'name'>[]>([])
  const [loaded, setLoaded] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | ExpenseReportStatus>('all')
  const [userFilter, setUserFilter] = useState<string>('all')
  // Hide upcoming events by default — buyers don't expense against
  // a show that hasn't happened yet, so cluttering the list with
  // future-dated reports just creates noise. Dropdown lets the user
  // peek at upcoming or see all.
  const [timeFilter, setTimeFilter] = useState<'past' | 'upcoming' | 'all'>('past')
  // Superadmins (Max etc.) default the User filter to themselves
  // — they almost always want their own queue first, and can flip
  // to "All users" in the dropdown when they need the cross-user
  // view. Accounting still defaults to All since their job is to
  // process every report. Only fires once per session.
  const userFilterDefaulted = useRef(false)
  useEffect(() => {
    if (userFilterDefaulted.current || !user) return
    if (user.role === 'superadmin' && user.id) {
      setUserFilter(user.id)
    }
    userFilterDefaulted.current = true
  }, [user])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [templates, setTemplates] = useState<ExpenseReportTemplate[]>([])
  const [pickerTemplateId, setPickerTemplateId] = useState<string>('')
  // Phase 14: sales-side parents fetched lazily for the picker +
  // for decorating list rows that point at trunk / trade shows.
  const [trunkShowsList, setTrunkShowsList] = useState<SalesParent[]>([])
  const [tradeShowsList, setTradeShowsList] = useState<SalesParent[]>([])

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

    // Pull sales-side parents in parallel. Reports tied to trunk
    // shows / trade shows reference these via their respective
    // FKs; we need the labels + dates to decorate the row.
    const trunkShowIds = Array.from(new Set(reportsArr.map(r => (r as any).trunk_show_id).filter(Boolean) as string[]))
    const tradeShowIds = Array.from(new Set(reportsArr.map(r => (r as any).trade_show_id).filter(Boolean) as string[]))
    const storesById = new Map(stores.map(s => [s.id, s]))
    let trunkShowsById = new Map<string, SalesParent>()
    let tradeShowsById = new Map<string, SalesParent>()
    if (trunkShowIds.length > 0) {
      const { data: tsRows } = await supabase.from('trunk_shows')
        .select('id, store_id, start_date, end_date').in('id', trunkShowIds)
      for (const t of (tsRows || [])) {
        const store = storesById.get(t.store_id as string)
        trunkShowsById.set(t.id as string, {
          id: t.id as string,
          start_date: t.start_date as string,
          end_date:   t.end_date   as string,
          label: `Trunk · ${store?.name || 'Store'}`,
        })
      }
    }
    if (tradeShowIds.length > 0) {
      const { data: tsRows } = await supabase.from('trade_shows')
        .select('id, name, start_date, end_date').in('id', tradeShowIds).is('deleted_at', null)
      for (const t of (tsRows || [])) {
        tradeShowsById.set(t.id as string, {
          id: t.id as string,
          start_date: t.start_date as string,
          end_date:   t.end_date   as string,
          label: `Trade · ${t.name}`,
        })
      }
    }

    const eventById = new Map(events.map(e => [e.id, e]))
    const userIds = Array.from(new Set(reportsArr.map(r => r.user_id)))
    let userMap = new Map<string, string>()
    if (userIds.length > 0) {
      const { data: usersRows } = await supabase
        .from('users').select('id, name').in('id', userIds)
      userMap = new Map((usersRows ?? []).map((u: any) => [u.id, u.name]))
      setUsers((usersRows ?? []) as any)
    }
    setRows(reportsArr.map(r => {
      const trunkId = (r as any).trunk_show_id as string | null
      const tradeId = (r as any).trade_show_id as string | null
      let kind: ReportRow['parent_kind'] = 'unknown'
      let name = '(unknown)'
      let start = ''
      if (r.event_id) {
        kind = 'buying'
        const e = eventById.get(r.event_id)
        name = e?.store_name || '(unknown event)'
        start = e?.start_date || ''
      } else if (trunkId) {
        kind = 'trunk'
        const t = trunkShowsById.get(trunkId)
        name = t?.label || 'Trunk show'
        start = t?.start_date || ''
      } else if (tradeId) {
        kind = 'trade'
        const t = tradeShowsById.get(tradeId)
        name = t?.label || 'Trade show'
        start = t?.start_date || ''
      }
      return {
        ...r,
        event_name:  name,
        event_start: start,
        user_name:   userMap.get(r.user_id) ?? '',
        parent_kind: kind,
      }
    }))
    setLoaded(true)
    return reportsArr
  }

  // Pre-load sales-side parent lists for the picker. Reads what
  // the current user is allowed to see via RLS — sales reps see
  // their assigned trunk shows + all trade shows; admins see
  // everything. Skipped silently if the tables don't return rows.
  async function loadParentLists() {
    try {
      const [{ data: ts }, { data: tr }] = await Promise.all([
        supabase.from('trunk_shows')
          .select('id, store_id, start_date, end_date')
          .is('deleted_at', null).order('start_date', { ascending: false }),
        supabase.from('trade_shows')
          .select('id, name, start_date, end_date')
          .is('deleted_at', null).order('start_date', { ascending: false }),
      ])
      const storesById = new Map(stores.map(s => [s.id, s]))
      setTrunkShowsList((ts || []).map(t => ({
        id: t.id, start_date: t.start_date, end_date: t.end_date,
        label: storesById.get(t.store_id)?.name || 'Store',
      })))
      setTradeShowsList((tr || []).map(t => ({
        id: t.id, start_date: t.start_date, end_date: t.end_date, label: t.name,
      })))
    } catch { /* swallow — picker degrades to buying-only */ }
  }
  useEffect(() => { void loadParentLists() /* eslint-disable-next-line */ }, [stores.length])

  /**
   * Idempotent backfill: every recent event the user is a worker
   * on gets an expense_reports row. The unique (event_id, user_id)
   * constraint makes the inserts safe to repeat — already-existing
   * rows are skipped.
   *
   * RECENT-ONLY GATE: only create rows for events whose start_date
   * is within the last AUTO_CREATE_LOOKBACK_DAYS days. Without
   * this, opening the page generated rows for every event the
   * user ever worked, including 2018-era ones — which then
   * tripped the daily expense-reminder cron and produced an email
   * storm (Tom: 10 emails, Elliott: 6 emails on 2026-05-02).
   */
  async function autoCreateMissingReports(existingReports: ExpenseReport[]): Promise<boolean> {
    if (!user) return false
    const AUTO_CREATE_LOOKBACK_DAYS = 90
    const cutoffMs = Date.now() - AUTO_CREATE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
    const cutoffIso = (() => {
      const d = new Date(cutoffMs)
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    })()
    const myReportEventIds = new Set(
      existingReports.filter(r => r.user_id === user.id).map(r => r.event_id),
    )
    const missing = events
      .filter(e => isWorkerAssigned(e, user.id))
      .filter(e => !myReportEventIds.has(e.id))
      .filter(e => e.start_date && e.start_date >= cutoffIso)
    if (missing.length === 0) return false
    const { error: insErr } = await supabase
      .from('expense_reports')
      .upsert(
        missing.map(e => ({ event_id: e.id, user_id: user.id })),
        { onConflict: 'event_id,user_id', ignoreDuplicates: true },
      )
    if (insErr) {
      console.warn('[expenses] auto-create reports failed:', insErr.message)
      return false
    }
    return true
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const initial = await reload()
      if (cancelled || !initial) return
      const created = await autoCreateMissingReports(initial)
      if (cancelled) return
      if (created) await reload()
    })()
    return () => { cancelled = true }
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [user?.id, events.length])

  async function deleteReport(r: ReportRow) {
    if (r.status !== 'active') return
    if (!confirm(`Delete the expense report for "${r.event_name}"? This can't be undone.`)) return
    const { error: delErr } = await supabase.from('expense_reports').delete().eq('id', r.id)
    if (delErr) {
      alert(`Could not delete: ${delErr.message}`)
      return
    }
    await reload()
  }

  // Load active templates once for the new-report picker.
  useEffect(() => {
    let cancelled = false
    supabase.from('expense_report_templates')
      .select('*').eq('is_active', true).order('name', { ascending: true })
      .then(({ data }) => {
        if (cancelled) return
        setTemplates((data ?? []) as ExpenseReportTemplate[])
      })
    return () => { cancelled = true }
  }, [])

  const todayIsoLocal = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  }, [])

  const filtered = useMemo(() => {
    return rows.filter(r => {
      // Accounting never sees drafts ("active") — those reports
      // haven't been submitted yet and aren't ready for AP.
      if (isAccounting && r.status === 'active') return false
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      // Time gate: past = event already started (incl. running),
      // upcoming = strictly future.
      if (timeFilter !== 'all' && r.event_start) {
        const isUpcoming = r.event_start > todayIsoLocal
        if (timeFilter === 'past' && isUpcoming) return false
        if (timeFilter === 'upcoming' && !isUpcoming) return false
      }
      if (canSeeAll) {
        // Superadmin: respect the dropdown ('all' shows everyone).
        if (userFilter !== 'all' && r.user_id !== userFilter) return false
      } else {
        // Everyone else: own reports only.
        if (r.user_id !== user?.id) return false
      }
      return true
    })
  }, [rows, statusFilter, userFilter, timeFilter, todayIsoLocal, canSeeAll, isAccounting, user?.id])

  // For the new-report picker: events the user can see, minus events
  // that already have a report for this user.
  const eligibleEvents = useMemo(() => {
    if (!user) return []
    const ownReportEventIds = new Set(rows.filter(r => r.user_id === user.id).map(r => r.event_id))
    return events
      .filter(e => !ownReportEventIds.has(e.id))
      .sort((a, b) => b.start_date.localeCompare(a.start_date))
  }, [events, rows, user?.id])

  async function createReport(parent: { kind: 'buying' | 'trunk' | 'trade'; id: string }) {
    if (!user) return
    setCreating(true); setError(null)
    const payload: any = { user_id: user.id }
    if (parent.kind === 'buying') payload.event_id = parent.id
    else if (parent.kind === 'trunk') payload.trunk_show_id = parent.id
    else payload.trade_show_id = parent.id
    if (pickerTemplateId) payload.template_id = pickerTemplateId
    const { data, error: insertErr } = await supabase
      .from('expense_reports')
      .insert(payload)
      .select('id')
      .single()
    setCreating(false)
    if (insertErr || !data) {
      setError(insertErr?.message ?? 'Could not create report.')
      return
    }
    setPickerOpen(false); setPickerTemplateId('')
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
          gridTemplateColumns: canSeeAll
            ? 'minmax(160px,1fr) minmax(160px,1fr) minmax(180px,1fr)'
            : 'minmax(160px,1fr) minmax(160px,1fr)',
          gap: 10,
        }}>
          <div>
            <label className="fl">Status</label>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}>
              {(isAccounting ? STATUS_FILTERS_ACCOUNTING : STATUS_FILTERS).map(s => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="fl">When</label>
            <select value={timeFilter} onChange={e => setTimeFilter(e.target.value as any)} style={{ width: '100%' }}>
              <option value="past">Past &amp; current events</option>
              <option value="upcoming">Upcoming events</option>
              <option value="all">All</option>
            </select>
          </div>
          {canSeeAll && (
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

      {/* Table — switches to a stacked card list on narrow viewports
          since the User column + buttons run off the side on phones. */}
      {isNarrow ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {!loaded ? (
            <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--mist)' }}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--mist)' }}>
              {rows.length === 0 ? 'No reports yet — create one with "+ New Report".' : 'No reports match the current filters.'}
            </div>
          ) : filtered.map(r => {
            const sc = STATUS_COLOR[r.status]
            const canDelete = r.status === 'active' && (r.user_id === user?.id || canSeeAll)
            return (
              <div key={r.id} className="card" style={{
                position: 'relative', padding: 12, background: '#fff',
              }}>
                <button onClick={() => onOpen(r.id)} style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  background: 'transparent', border: 'none', padding: 0,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink)', marginBottom: 2 }}>
                        {r.event_name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--mist)' }}>
                        {r.event_start ? formatDateLong(r.event_start) : '—'}
                        {canSeeAll && r.user_name ? ` · ${r.user_name}` : ''}
                      </div>
                    </div>
                    <span style={{
                      background: sc.bg, color: sc.fg,
                      padding: '2px 10px', borderRadius: 999,
                      fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap',
                    }}>{STATUS_LABEL[r.status]}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 8 }}>
                    <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>
                      {formatCurrency(r.grand_total)}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--green-dark)' }}>Open →</span>
                  </div>
                </button>
                {canDelete && (
                  <button
                    onClick={e => { e.stopPropagation(); deleteReport(r) }}
                    title="Delete this report"
                    aria-label="Delete this report"
                    style={{
                      position: 'absolute', top: 8, right: 8,
                      background: 'transparent', border: 'none',
                      padding: 4, cursor: 'pointer', color: 'var(--mist)',
                      fontSize: 16, lineHeight: 1,
                    }}
                  >×</button>
                )}
              </div>
            )
          })}
        </div>
      ) : (
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--cream2)', borderBottom: '2px solid var(--pearl)' }}>
                {['Event', 'Date', canSeeAll ? 'User' : '', 'Status', 'Total', ''].filter(Boolean).map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!loaded ? (
                <tr><td colSpan={canSeeAll ? 6 : 5} style={{ padding: 30, textAlign: 'center', color: 'var(--mist)' }}>Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={canSeeAll ? 6 : 5} style={{ padding: 30, textAlign: 'center', color: 'var(--mist)' }}>
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
                    {canSeeAll && <td style={{ padding: '10px 12px', color: 'var(--ash)' }}>{r.user_name}</td>}
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
                    <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button onClick={e => { e.stopPropagation(); onOpen(r.id) }}
                        className="btn-outline btn-sm">Open →</button>
                      {r.status === 'active' && (r.user_id === user?.id || canSeeAll) && (
                        <button
                          onClick={e => { e.stopPropagation(); deleteReport(r) }}
                          title="Delete this report"
                          aria-label="Delete this report"
                          style={{
                            marginLeft: 6, background: 'transparent',
                            border: '1px solid var(--cream2)', borderRadius: 6,
                            padding: '4px 8px', cursor: 'pointer', color: 'var(--mist)',
                            fontSize: 14, lineHeight: 1,
                          }}
                        >×</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* New-report picker */}
      {pickerOpen && (
        <div onClick={e => e.target === e.currentTarget && setPickerOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ width: 'min(560px, 100%)', maxHeight: '80vh', overflowY: 'auto', background: 'var(--cream)', borderRadius: 12, padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>Pick an event</h2>
              <button onClick={() => setPickerOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--mist)' }}>×</button>
            </div>

            {templates.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <label className="fl">Apply template (optional)</label>
                <select value={pickerTemplateId} onChange={e => setPickerTemplateId(e.target.value)}>
                  <option value="">— None —</option>
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name}{t.estimated_days ? ` (${t.estimated_days} days)` : ''}
                    </option>
                  ))}
                </select>
                <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 4 }}>
                  Templates add a checklist of expected categories to the new report.
                </div>
              </div>
            )}
            <PickerBody
              creating={creating}
              eligibleEvents={eligibleEvents}
              trunkShows={trunkShowsList}
              tradeShows={tradeShowsList}
              existingTrunkIds={new Set(rows.filter(r => r.user_id === user?.id).map(r => (r as any).trunk_show_id).filter(Boolean) as string[])}
              existingTradeIds={new Set(rows.filter(r => r.user_id === user?.id).map(r => (r as any).trade_show_id).filter(Boolean) as string[])}
              onPick={(p) => createReport(p)}
            />
          </div>
        </div>
      )}
    </div>
  )
}

/* ── new-report picker body (shared shell, parent-type tabs) ── */

function PickerBody({
  creating, eligibleEvents, trunkShows, tradeShows,
  existingTrunkIds, existingTradeIds, onPick,
}: {
  creating: boolean
  eligibleEvents: Event[]
  trunkShows: SalesParent[]
  tradeShows: SalesParent[]
  existingTrunkIds: Set<string>
  existingTradeIds: Set<string>
  onPick: (p: { kind: 'buying' | 'trunk' | 'trade'; id: string }) => void
}) {
  const [kind, setKind] = useState<'buying' | 'trunk' | 'trade'>('buying')
  const showTrunk = trunkShows.length > 0
  const showTrade = tradeShows.length > 0
  const hasOnlyOne = !showTrunk && !showTrade
  const trunkAvail = trunkShows.filter(t => !existingTrunkIds.has(t.id))
  const tradeAvail = tradeShows.filter(t => !existingTradeIds.has(t.id))

  const fmt = (s: string, e: string) => {
    if (!s) return ''
    if (s === e || !e) return formatDateLong(s)
    return `${formatDateLong(s)} – ${formatDateLong(e)}`
  }

  return (
    <>
      {!hasOnlyOne && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          <button onClick={() => setKind('buying')}
            className={kind === 'buying' ? 'btn-primary btn-xs' : 'btn-outline btn-xs'}>Buying Event</button>
          {showTrunk && (
            <button onClick={() => setKind('trunk')}
              className={kind === 'trunk' ? 'btn-primary btn-xs' : 'btn-outline btn-xs'}>Trunk Show</button>
          )}
          {showTrade && (
            <button onClick={() => setKind('trade')}
              className={kind === 'trade' ? 'btn-primary btn-xs' : 'btn-outline btn-xs'}>Trade Show</button>
          )}
        </div>
      )}

      {kind === 'buying' && (
        eligibleEvents.length === 0 ? (
          <Empty msg="No buying events without a report. Create an event first, or open an existing report from the list." />
        ) : (
          <PickList items={eligibleEvents.map(ev => ({
            id: ev.id, label: ev.store_name, sub: formatDateLong(ev.start_date),
          }))} disabled={creating} onPick={(id) => onPick({ kind: 'buying', id })} />
        )
      )}
      {kind === 'trunk' && (
        trunkAvail.length === 0 ? (
          <Empty msg="No trunk shows without a report (or none assigned to you)." />
        ) : (
          <PickList items={trunkAvail.map(t => ({
            id: t.id, label: t.label, sub: fmt(t.start_date, t.end_date),
          }))} disabled={creating} onPick={(id) => onPick({ kind: 'trunk', id })} />
        )
      )}
      {kind === 'trade' && (
        tradeAvail.length === 0 ? (
          <Empty msg="No trade shows without a report." />
        ) : (
          <PickList items={tradeAvail.map(t => ({
            id: t.id, label: t.label, sub: fmt(t.start_date, t.end_date),
          }))} disabled={creating} onPick={(id) => onPick({ kind: 'trade', id })} />
        )
      )}
    </>
  )
}

function PickList({ items, disabled, onPick }: {
  items: { id: string; label: string; sub: string }[]
  disabled: boolean
  onPick: (id: string) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map(it => (
        <button key={it.id} disabled={disabled} onClick={() => onPick(it.id)}
          style={{
            textAlign: 'left', padding: '12px 14px', borderRadius: 8,
            background: '#fff', border: '1px solid var(--cream2)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            fontFamily: 'inherit',
          }}>
          <div>
            <div style={{ fontWeight: 800, color: 'var(--ink)' }}>{it.label}</div>
            <div style={{ fontSize: 12, color: 'var(--mist)' }}>{it.sub}</div>
          </div>
          <span style={{ color: 'var(--green)', fontWeight: 700 }}>+ Create</span>
        </button>
      ))}
    </div>
  )
}

function Empty({ msg }: { msg: string }) {
  return <div style={{ padding: 20, textAlign: 'center', color: 'var(--mist)' }}>{msg}</div>
}
