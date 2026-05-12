'use client'

// Sheet-style view of marketing campaigns. Same `marketing_campaigns`
// rows the List view reads; just a different render. One row per
// campaign with inline-editable Budget + Mail-by and a one-click
// Notify Team button. Click anywhere outside an edit cell to open
// the full CampaignDetail.
//
// Default sort: mail-by ascending, with at-risk rows floated to top
// (within 3 days of mail-by AND status not yet paid). That puts the
// campaigns you need to act on first.
//
// Default columns are tight (6 cols). Everything else lives in the
// "⚙ Edit columns" picker. User selection persists per-browser.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type { MarketingCampaign, MarketingFlowType, MarketingStatus, Event } from '@/types'
import DatePicker from '@/components/ui/DatePicker'
import SheetColumnPicker, { type SheetColumnDef } from '@/components/ui/SheetColumnPicker'

type SortKey = 'mail_by' | 'event_date' | 'status' | 'campaign'
type SortDir = 'asc' | 'desc'
type RowSaveStatus = 'idle' | 'saving' | 'saved' | 'error'

const FLOW_LABEL: Record<MarketingFlowType, string> = {
  vdp: '📬 VDP',
  postcard: '📮 Postcard',
  newspaper: '📰 Newspaper',
}

const STATUS_META: Record<MarketingStatus, { label: string; color: string }> = {
  setup:    { label: 'Setup',    color: 'var(--silver)' },
  planning: { label: 'Planning', color: '#f59e0b' },
  proofing: { label: 'Proofing', color: '#3b82f6' },
  payment:  { label: 'Payment',  color: '#a855f7' },
  done:     { label: 'Done',     color: 'var(--green-dark)' },
}

const COLUMNS: SheetColumnDef[] = [
  { id: 'campaign',           label: 'Campaign',          group: 'core', locked: true },
  { id: 'status',             label: 'Status',            group: 'core' },
  { id: 'budget',             label: 'Budget',            group: 'core' },
  { id: 'mail_by',            label: 'Mail-by',           group: 'core' },
  { id: 'notify',             label: 'Notify Team',       group: 'core' },
  { id: 'days_to_mail_by',    label: 'Days to Mail-by',   group: 'core' },
  { id: 'brand',              label: 'Brand',             group: 'meta' },
  { id: 'sub_status',         label: 'Sub-status',        group: 'meta' },
  { id: 'created_at',         label: 'Created',           group: 'meta' },
  { id: 'proof_approved',     label: 'Proof Approved',    group: 'phases' },
  { id: 'payment_authorized', label: 'Payment Authorized', group: 'phases' },
  { id: 'paid_at',            label: 'Paid',              group: 'phases' },
  { id: 'done_at',            label: 'Done',              group: 'phases' },
]
const DEFAULT_COL_IDS = ['campaign', 'status', 'budget', 'mail_by', 'notify', 'days_to_mail_by']
const COLUMN_GROUPS = [
  { id: 'core',   label: 'Core' },
  { id: 'phases', label: 'Phase dates' },
  { id: 'meta',   label: 'Meta' },
]
const STORAGE_KEY = 'beb.marketing_campaigns_sheet.cols'
const SORT_STORAGE_KEY = 'beb.marketing_campaigns_sheet.sort'
const AT_RISK_DAYS = 3
const TODAY_ISO = () => new Date().toISOString().slice(0, 10)

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return ''
  return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso + (iso.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function daysBetween(a: string, b: string): number {
  const ma = new Date(a + 'T00:00:00Z').getTime()
  const mb = new Date(b + 'T00:00:00Z').getTime()
  return Math.round((ma - mb) / 86400000)
}
function isAtRisk(c: MarketingCampaign, today: string): boolean {
  if (!c.mail_by_date) return false
  if (c.status === 'payment' || c.status === 'done') return false
  return daysBetween(c.mail_by_date, today) <= AT_RISK_DAYS
}

interface Props {
  campaigns: MarketingCampaign[]
  /** Called when an inline edit succeeded — parent reloads. */
  onChanged: () => void
  onOpenCampaign: (id: string) => void
}

export default function CampaignsSheet({ campaigns, onChanged, onOpenCampaign }: Props) {
  const { allEvents: events, stores } = useApp()
  const eventById = useMemo(() => new Map(events.map(e => [e.id, e])), [events])
  const storeById = useMemo(() => new Map(stores.map(s => [s.id, s])), [stores])
  const today = TODAY_ISO()

  // Column visibility (persisted per browser).
  const [visibleCols, setVisibleCols] = useState<string[]>(DEFAULT_COL_IDS)
  const [showColPicker, setShowColPicker] = useState(false)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed.every(x => typeof x === 'string')) {
          setVisibleCols(parsed)
        }
      }
    } catch {}
  }, [])
  function persistCols(next: string[]) {
    setVisibleCols(next)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch {}
  }

  // Sort (persisted per browser).
  const [sortKey, setSortKey] = useState<SortKey>('mail_by')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SORT_STORAGE_KEY)
      if (raw) {
        const { key, dir } = JSON.parse(raw)
        if (key) setSortKey(key)
        if (dir) setSortDir(dir)
      }
    } catch {}
  }, [])
  function setSort(next: SortKey) {
    const nextDir: SortDir = sortKey === next ? (sortDir === 'asc' ? 'desc' : 'asc') : 'asc'
    setSortKey(next); setSortDir(nextDir)
    try { localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify({ key: next, dir: nextDir })) } catch {}
  }

  const sorted = useMemo(() => {
    const rows = [...campaigns]
    rows.sort((a, b) => {
      // At-risk float regardless of column sort.
      const aRisk = isAtRisk(a, today)
      const bRisk = isAtRisk(b, today)
      if (aRisk !== bRisk) return aRisk ? -1 : 1

      const getKey = (c: MarketingCampaign): string | number => {
        const ev = eventById.get(c.event_id)
        switch (sortKey) {
          case 'mail_by':    return c.mail_by_date || '9999-12-31'
          case 'event_date': return ev?.start_date || '9999-12-31'
          case 'status':     return c.status
          case 'campaign': {
            const store = ev ? storeById.get(ev.store_id) : undefined
            return (store?.name || ev?.store_name || '').toLowerCase()
          }
        }
      }
      const ka = getKey(a), kb = getKey(b)
      if (ka < kb) return sortDir === 'asc' ? -1 : 1
      if (ka > kb) return sortDir === 'asc' ?  1 : -1
      return 0
    })
    return rows
  }, [campaigns, sortKey, sortDir, today, eventById, storeById])

  // Inline edit / save state per row + cell.
  const [savingId, setSavingId] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; field: 'budget' | 'mail_by' } | null>(null)
  const [draftBudget, setDraftBudget] = useState('')
  const [notifyingId, setNotifyingId] = useState<string | null>(null)

  function startEdit(c: MarketingCampaign, field: 'budget' | 'mail_by') {
    setError(null)
    setEditing({ id: c.id, field })
    if (field === 'budget') setDraftBudget(c.marketing_budget != null ? String(c.marketing_budget) : '')
  }
  function cancelEdit() { setEditing(null); setDraftBudget('') }

  async function saveBudget(c: MarketingCampaign) {
    const n = Number(draftBudget)
    if (!Number.isFinite(n) || n < 0) { setError('Budget must be a non-negative number.'); return }
    setSavingId(c.id); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const me = session?.user?.id
      const { error: e } = await supabase.from('marketing_campaigns').update({
        marketing_budget: n,
        budget_set_at: new Date().toISOString(),
        budget_set_by: me ?? null,
      }).eq('id', c.id)
      if (e) throw e
      setEditing(null); setDraftBudget('')
      setSavedFlash(c.id); setTimeout(() => setSavedFlash(null), 1200)
      onChanged()
    } catch (e: any) {
      setError(e?.message || 'Save failed.')
    } finally {
      setSavingId(null)
    }
  }
  async function saveMailBy(c: MarketingCampaign, nextIso: string | null) {
    setSavingId(c.id); setError(null)
    try {
      const { error: e } = await supabase.from('marketing_campaigns').update({
        mail_by_date: nextIso,
      }).eq('id', c.id)
      if (e) throw e
      setEditing(null)
      setSavedFlash(c.id); setTimeout(() => setSavedFlash(null), 1200)
      onChanged()
    } catch (e: any) {
      setError(e?.message || 'Save failed.')
    } finally {
      setSavingId(null)
    }
  }
  async function notifyTeam(c: MarketingCampaign) {
    if (!c.marketing_budget) { setError('Set a budget before notifying.'); return }
    setNotifyingId(c.id); setError(null)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token
      const res = await fetch(`/api/marketing/campaigns/${c.id}/notify-team`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error || `Notify failed (${res.status})`)
      } else {
        setSavedFlash(c.id); setTimeout(() => setSavedFlash(null), 1500)
        onChanged()
      }
    } catch (e: any) {
      setError(e?.message || 'Notify failed.')
    } finally {
      setNotifyingId(null)
    }
  }

  // -------- Cell renderers --------

  function renderCampaignCell(c: MarketingCampaign) {
    const ev = eventById.get(c.event_id)
    const store = ev ? storeById.get(ev.store_id) : undefined
    const name = store?.name || ev?.store_name || '(unknown store)'
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span style={{ fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {name}
        </span>
        <span style={{ fontSize: 11, color: 'var(--mist)', whiteSpace: 'nowrap' }}>
          {ev?.start_date ? fmtDate(ev.start_date) : '—'}
        </span>
        <span style={{
          fontSize: 10, fontWeight: 800, padding: '2px 6px', borderRadius: 6,
          background: 'var(--cream2)', color: 'var(--ash)', whiteSpace: 'nowrap', letterSpacing: '.03em',
        }}>
          {FLOW_LABEL[c.flow_type]}
        </span>
        {isAtRisk(c, today) && (
          <span title={`Within ${AT_RISK_DAYS} days of mail-by`} style={{ color: '#dc2626', fontSize: 14, fontWeight: 800 }}>⚠</span>
        )}
      </div>
    )
  }
  function renderStatusCell(c: MarketingCampaign) {
    const m = STATUS_META[c.status]
    return (
      <span style={{
        background: m.color, color: '#fff', padding: '2px 8px', borderRadius: 99,
        fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em',
        whiteSpace: 'nowrap',
      }}>{m.label}</span>
    )
  }
  function renderBudgetCell(c: MarketingCampaign) {
    const isEdit = editing?.id === c.id && editing.field === 'budget'
    if (isEdit) {
      return (
        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <span style={{ color: 'var(--mist)' }}>$</span>
          <input type="number" min={0} step="0.01" value={draftBudget}
            onChange={e => setDraftBudget(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void saveBudget(c)
              if (e.key === 'Escape') cancelEdit()
            }}
            autoFocus
            style={{ width: 90, padding: '4px 6px', fontSize: 12 }} />
          <button onClick={() => void saveBudget(c)} disabled={savingId === c.id}
            className="btn-primary btn-xs">{savingId === c.id ? '…' : '✓'}</button>
          <button onClick={cancelEdit} className="btn-outline btn-xs">✕</button>
        </span>
      )
    }
    return (
      <button type="button" onClick={() => startEdit(c, 'budget')}
        style={{
          fontFamily: 'inherit', fontSize: 13, fontWeight: 700, color: c.marketing_budget != null ? 'var(--ink)' : 'var(--mist)',
          background: 'transparent', border: '1px dashed transparent', padding: '2px 6px', borderRadius: 4, cursor: 'pointer',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--pearl)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent' }}>
        {c.marketing_budget != null ? fmtMoney(c.marketing_budget) : '— set —'}
      </button>
    )
  }
  function renderMailByCell(c: MarketingCampaign) {
    const isEdit = editing?.id === c.id && editing.field === 'mail_by'
    if (isEdit) {
      return (
        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <DatePicker value={c.mail_by_date || ''}
            onChange={(v) => void saveMailBy(c, v || null)} />
          <button onClick={cancelEdit} className="btn-outline btn-xs">✕</button>
        </span>
      )
    }
    return (
      <button type="button" onClick={() => startEdit(c, 'mail_by')}
        style={{
          fontFamily: 'inherit', fontSize: 13, color: c.mail_by_date ? 'var(--ink)' : 'var(--mist)',
          background: 'transparent', border: '1px dashed transparent', padding: '2px 6px', borderRadius: 4, cursor: 'pointer',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--pearl)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent' }}>
        {c.mail_by_date ? fmtDate(c.mail_by_date) : '— set —'}
      </button>
    )
  }
  function renderNotifyCell(c: MarketingCampaign) {
    const busy = notifyingId === c.id
    if (!c.marketing_budget) {
      return <span style={{ fontSize: 11, color: 'var(--mist)', fontStyle: 'italic' }}>set budget first</span>
    }
    if (c.team_notified_at) {
      return (
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 11, color: 'var(--mist)' }}>
          ✓ {fmtDate(c.team_notified_at)}
          <button onClick={() => void notifyTeam(c)} disabled={busy}
            title="Re-send notification to the marketing team"
            className="btn-outline btn-xs">{busy ? '…' : '↻'}</button>
        </span>
      )
    }
    return (
      <button onClick={() => void notifyTeam(c)} disabled={busy}
        className="btn-primary btn-xs">{busy ? 'Sending…' : '📧 Notify'}</button>
    )
  }
  function renderDaysToMailBy(c: MarketingCampaign) {
    if (!c.mail_by_date) return <span style={{ color: 'var(--mist)' }}>—</span>
    const d = daysBetween(c.mail_by_date, today)
    if (c.status === 'done') return <span style={{ color: 'var(--mist)' }}>done</span>
    if (d < 0) return <span style={{ color: '#dc2626', fontWeight: 700 }}>{Math.abs(d)}d overdue</span>
    if (d === 0) return <span style={{ color: '#dc2626', fontWeight: 700 }}>today</span>
    if (d <= AT_RISK_DAYS) return <span style={{ color: '#dc2626', fontWeight: 700 }}>{d}d</span>
    return <span>{d}d</span>
  }

  function renderCell(c: MarketingCampaign, col: string) {
    switch (col) {
      case 'campaign':           return renderCampaignCell(c)
      case 'status':             return renderStatusCell(c)
      case 'budget':             return renderBudgetCell(c)
      case 'mail_by':            return renderMailByCell(c)
      case 'notify':             return renderNotifyCell(c)
      case 'days_to_mail_by':    return renderDaysToMailBy(c)
      case 'brand':              return <span>{(c as any).brand || ''}</span>
      case 'sub_status':         return <span style={{ fontSize: 12, color: 'var(--mist)' }}>{c.sub_status || '—'}</span>
      case 'created_at':         return <span style={{ fontSize: 12 }}>{fmtDate(c.created_at?.slice(0, 10))}</span>
      case 'proof_approved':     return <span style={{ fontSize: 12 }}>{(c as any).proof_approved_at ? fmtDate((c as any).proof_approved_at.slice(0, 10)) : '—'}</span>
      case 'payment_authorized': return <span style={{ fontSize: 12 }}>{c.payment_authorized_at ? fmtDate(c.payment_authorized_at.slice(0, 10)) : '—'}</span>
      case 'paid_at':            return <span style={{ fontSize: 12 }}>{c.paid_at ? fmtDate(c.paid_at.slice(0, 10)) : '—'}</span>
      case 'done_at':            return <span style={{ fontSize: 12 }}>{c.status === 'done' ? fmtDate(c.updated_at?.slice(0, 10)) : '—'}</span>
      default: return null
    }
  }

  // Map column id → header label + sort key (only some are sortable).
  const COL_LABEL: Record<string, string> = Object.fromEntries(COLUMNS.map(c => [c.id, c.label]))
  const COL_SORT_KEY: Partial<Record<string, SortKey>> = {
    campaign: 'campaign',
    status:   'status',
    mail_by:  'mail_by',
  }

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, color: 'var(--mist)' }}>
          {sorted.length === 0 ? 'No campaigns' : `${sorted.length} campaign${sorted.length === 1 ? '' : 's'}`}
        </div>
        <button className="btn-outline btn-xs" onClick={() => setShowColPicker(true)}>
          ⚙ Edit columns
        </button>
      </div>

      {error && (
        <div style={{
          background: 'var(--red-pale)', color: '#7f1d1d', border: '1px solid #fecaca',
          padding: '6px 10px', borderRadius: 6, fontSize: 12, marginBottom: 8,
        }}>{error}</div>
      )}

      {/* Sheet */}
      <div style={{ overflowX: 'auto', border: '1px solid var(--pearl)', borderRadius: 8, background: '#fff' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--cream)', borderBottom: '2px solid var(--pearl)' }}>
              {visibleCols.map(col => {
                const key = COL_SORT_KEY[col]
                const active = key && sortKey === key
                return (
                  <th key={col} style={{
                    padding: '8px 10px', textAlign: 'left',
                    fontSize: 11, fontWeight: 800, color: 'var(--ash)',
                    textTransform: 'uppercase', letterSpacing: '.04em',
                    cursor: key ? 'pointer' : 'default', whiteSpace: 'nowrap',
                  }}
                    onClick={() => key && setSort(key)}>
                    {COL_LABEL[col] || col}
                    {active && <span style={{ marginLeft: 4, color: 'var(--ink)' }}>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((c, i) => {
              const isFlashing = savedFlash === c.id
              return (
                <tr key={c.id}
                  onClick={() => onOpenCampaign(c.id)}
                  style={{
                    borderBottom: i < sorted.length - 1 ? '1px solid var(--cream2)' : 'none',
                    background: isFlashing ? 'var(--green-pale)' : '#fff',
                    cursor: 'pointer',
                    transition: 'background .15s ease',
                  }}
                  onMouseEnter={e => { if (!isFlashing) (e.currentTarget as HTMLTableRowElement).style.background = 'var(--cream)' }}
                  onMouseLeave={e => { if (!isFlashing) (e.currentTarget as HTMLTableRowElement).style.background = '#fff' }}>
                  {visibleCols.map(col => (
                    <td key={col}
                      onClick={(e) => {
                        // Cells with interactive controls swallow the row click.
                        if (col === 'budget' || col === 'mail_by' || col === 'notify') e.stopPropagation()
                      }}
                      style={{ padding: '10px 10px', verticalAlign: 'middle' }}>
                      {renderCell(c, col)}
                    </td>
                  ))}
                </tr>
              )
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={visibleCols.length} style={{ padding: 24, textAlign: 'center', color: 'var(--mist)', fontStyle: 'italic' }}>
                  No campaigns to show.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showColPicker && (
        <SheetColumnPicker
          title="Marketing sheet columns"
          columns={COLUMNS}
          selected={visibleCols}
          defaults={DEFAULT_COL_IDS}
          groups={COLUMN_GROUPS}
          onChange={persistCols}
          onClose={() => setShowColPicker(false)}
        />
      )}
    </div>
  )
}
