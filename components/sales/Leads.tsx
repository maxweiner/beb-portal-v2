'use client'

// Leads top-level page. Three pipelines via the lead_kind enum:
//   trade_show    — sales-rep booth captures (existing)
//   buying_event  — stores BEB might pitch on hosting an estate event
//   trunk_show    — stores BEB might pitch on hosting a trunk show
//
// Tabs gate by role: sales_rep sees only Trade Shows;
// admin/superadmin/partner see all three.
//
// View toggle (List ↔ Kanban) persists in localStorage.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import { listLeads } from '@/lib/sales/leads'
import type { Lead, LeadInterestLevel, LeadKind, LeadStatus } from '@/types'
import AddLeadModal from './AddLeadModal'
import LeadDetail from './LeadDetail'
import type { NavPage } from '@/app/page'

type StatusFilter = 'all' | LeadStatus
type InterestFilter = 'all' | LeadInterestLevel
type ViewMode = 'list' | 'kanban'

const STATUS_LABEL: Record<LeadStatus, string> = {
  new: 'New', contacted: 'Contacted', converted: 'Converted', dead: 'Dead',
}
const STATUS_COLOR: Record<LeadStatus, { bg: string; fg: string }> = {
  new:        { bg: '#FEF3C7', fg: '#92400E' },
  contacted:  { bg: '#DBEAFE', fg: '#1E40AF' },
  converted:  { bg: '#D1FAE5', fg: '#065F46' },
  dead:       { bg: '#E5E7EB', fg: '#374151' },
}
const INTEREST_ICON: Record<LeadInterestLevel, string> = { hot: '🔥', warm: '🌤️', cold: '❄️' }

const KIND_TABS: { kind: LeadKind; label: string; emoji: string; convertedLabel: string }[] = [
  { kind: 'trade_show',   label: 'Trade Shows',   emoji: '🎯', convertedLabel: 'Converted' },
  { kind: 'buying_event', label: 'Buying Events', emoji: '💎', convertedLabel: 'Booked' },
  { kind: 'trunk_show',   label: 'Trunk Shows',   emoji: '👜', convertedLabel: 'Booked' },
]
const VIEW_KEY = 'beb-leads-view-mode'
const TAB_KEY  = 'beb-leads-active-tab'

const STATUS_ORDER: LeadStatus[] = ['new', 'contacted', 'converted', 'dead']

export default function Leads({ setNav }: { setNav?: (n: NavPage) => void }) {
  const { user, users } = useApp()
  const isAdminLike = user?.role === 'admin' || user?.role === 'superadmin' || !!user?.is_partner

  const allowedTabs = useMemo(
    () => isAdminLike ? KIND_TABS : KIND_TABS.filter(t => t.kind === 'trade_show'),
    [isAdminLike],
  )

  const [activeKind, setActiveKind] = useState<LeadKind>(() => {
    if (typeof window === 'undefined') return 'trade_show'
    const saved = window.localStorage.getItem(TAB_KEY) as LeadKind | null
    if (saved && KIND_TABS.some(t => t.kind === saved)) return saved
    return 'trade_show'
  })
  const [view, setView] = useState<ViewMode>(() => {
    if (typeof window === 'undefined') return 'list'
    const saved = window.localStorage.getItem(VIEW_KEY)
    return saved === 'kanban' ? 'kanban' : 'list'
  })

  useEffect(() => {
    try { window.localStorage.setItem(TAB_KEY, activeKind) } catch {}
  }, [activeKind])
  useEffect(() => {
    try { window.localStorage.setItem(VIEW_KEY, view) } catch {}
  }, [view])

  // If a sales-rep lands here with a saved tab they can no longer
  // see, snap back to trade_show.
  useEffect(() => {
    if (!allowedTabs.some(t => t.kind === activeKind)) setActiveKind('trade_show')
  }, [allowedTabs, activeKind])

  const activeTab = KIND_TABS.find(t => t.kind === activeKind)!

  const [rows, setRows] = useState<Lead[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [interestFilter, setInterestFilter] = useState<InterestFilter>('all')
  const [repFilter, setRepFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  async function reload() {
    setError(null)
    try { setRows(await listLeads()) }
    catch (err: any) { setError(err?.message || 'Failed to load') }
    setLoaded(true)
  }
  useEffect(() => { void reload() }, [])

  const usersById = useMemo(() => new Map(users.map(u => [u.id, u])), [users])

  const rowsForKind = useMemo(
    () => rows.filter(r => (r.lead_kind || 'trade_show') === activeKind),
    [rows, activeKind],
  )

  const repOptions = useMemo(() => Array.from(
    new Set(rowsForKind.map(r => r.assigned_rep_id).filter(Boolean) as string[])
  ).map(id => ({ id, name: usersById.get(id)?.name || '(unknown)' })), [rowsForKind, usersById])

  const filtered = useMemo(() => rowsForKind.filter(r => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false
    if (interestFilter !== 'all' && r.interest_level !== interestFilter) return false
    if (repFilter !== 'all' && r.assigned_rep_id !== repFilter) return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      const hay = [
        r.first_name, r.last_name, r.company_name,
        r.email, r.phone, r.store_phone, r.cell_phone,
        r.city, r.state,
      ].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  }), [rowsForKind, statusFilter, interestFilter, repFilter, search])

  if (openId) {
    return (
      <LeadDetail
        leadId={openId}
        onBack={() => setOpenId(null)}
        onChanged={() => void reload()}
        onDeleted={() => { setOpenId(null); void reload() }}
        setNav={setNav}
      />
    )
  }

  return (
    <div className="p-6" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)' }}>🎯 Leads</h1>
        <button className="btn-primary btn-sm" onClick={() => setCreateOpen(true)}>+ Add Lead</button>
      </div>

      {/* Tabs */}
      {allowedTabs.length > 1 && (
        <div style={{
          display: 'flex', gap: 6, marginBottom: 12, borderBottom: '1px solid var(--pearl)',
        }}>
          {allowedTabs.map(t => {
            const sel = activeKind === t.kind
            const count = rows.filter(r => (r.lead_kind || 'trade_show') === t.kind).length
            return (
              <button
                key={t.kind}
                onClick={() => setActiveKind(t.kind)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  borderBottom: sel ? '3px solid var(--green-dark)' : '3px solid transparent',
                  padding: '10px 14px',
                  fontFamily: 'inherit',
                  fontSize: 13,
                  fontWeight: sel ? 800 : 600,
                  color: sel ? 'var(--ink)' : 'var(--mist)',
                  cursor: 'pointer',
                  marginBottom: -1,
                }}
              >
                <span style={{ marginRight: 6 }}>{t.emoji}</span>
                {t.label}
                <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--mist)', fontWeight: 600 }}>· {count}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Filters + view toggle */}
      <div className="card" style={{ marginBottom: 12, padding: 12 }}>
        <div style={{
          display: 'grid', gap: 10,
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          alignItems: 'end',
        }}>
          <div>
            <label className="fl">Search</label>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Name, store, email…" />
          </div>
          {view === 'list' && (
            <div>
              <label className="fl">Status</label>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusFilter)}>
                <option value="all">All</option>
                <option value="new">New</option>
                <option value="contacted">Contacted</option>
                <option value="converted">{activeTab.convertedLabel}</option>
                <option value="dead">Dead</option>
              </select>
            </div>
          )}
          <div>
            <label className="fl">Interest</label>
            <select value={interestFilter} onChange={e => setInterestFilter(e.target.value as InterestFilter)}>
              <option value="all">All</option>
              <option value="hot">🔥 Hot</option>
              <option value="warm">🌤️ Warm</option>
              <option value="cold">❄️ Cold</option>
            </select>
          </div>
          {(isAdminLike || repOptions.length > 1) && (
            <div>
              <label className="fl">Assigned rep</label>
              <select value={repFilter} onChange={e => setRepFilter(e.target.value)}>
                <option value="all">All reps</option>
                {repOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="fl">View</label>
            <div style={{ display: 'flex', gap: 4, background: 'var(--cream2)', borderRadius: 6, padding: 2 }}>
              {(['list', 'kanban'] as ViewMode[]).map(v => {
                const sel = view === v
                return (
                  <button key={v} onClick={() => setView(v)}
                    style={{
                      flex: 1, padding: '6px 10px', fontSize: 12, fontWeight: 700,
                      background: sel ? '#fff' : 'transparent',
                      border: 'none', borderRadius: 4, cursor: 'pointer',
                      color: sel ? 'var(--ink)' : 'var(--mist)',
                      fontFamily: 'inherit',
                    }}>
                    {v === 'list' ? '☰ List' : '⊞ Kanban'}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="card" style={{ padding: 14, marginBottom: 12, background: '#FEE2E2', color: '#991B1B' }}>{error}</div>
      )}

      {!loaded ? (
        <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--mist)' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--mist)' }}>
          {rowsForKind.length === 0
            ? `No ${activeTab.label.toLowerCase()} leads yet. Click "+ Add Lead" to capture one.`
            : 'No leads match the current filters.'}
        </div>
      ) : view === 'kanban' ? (
        <KanbanView rows={filtered} usersById={usersById} convertedLabel={activeTab.convertedLabel} onOpen={setOpenId} />
      ) : (
        <ListView rows={filtered} usersById={usersById} convertedLabel={activeTab.convertedLabel} onOpen={setOpenId} />
      )}

      {createOpen && (
        <AddLeadModal
          defaultKind={activeKind}
          onCreated={(lead) => {
            setCreateOpen(false)
            void reload()
            setOpenId(lead.id)
          }}
          onClose={() => setCreateOpen(false)}
        />
      )}
    </div>
  )
}

/* ── List view ───────────────────────────────────────────── */

function ListView({ rows, usersById, convertedLabel, onOpen }: {
  rows: Lead[]
  usersById: Map<string, any>
  convertedLabel: string
  onOpen: (id: string) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map(l => (
        <LeadCard key={l.id} lead={l} usersById={usersById} convertedLabel={convertedLabel} onOpen={onOpen} />
      ))}
    </div>
  )
}

/* ── Kanban view ─────────────────────────────────────────── */

function KanbanView({ rows, usersById, convertedLabel, onOpen }: {
  rows: Lead[]
  usersById: Map<string, any>
  convertedLabel: string
  onOpen: (id: string) => void
}) {
  const buckets = useMemo(() => {
    const m: Record<LeadStatus, Lead[]> = { new: [], contacted: [], converted: [], dead: [] }
    for (const r of rows) m[r.status].push(r)
    return m
  }, [rows])

  return (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(4, minmax(220px, 1fr))', overflowX: 'auto' }}>
      {STATUS_ORDER.map(status => {
        const list = buckets[status]
        const sc = STATUS_COLOR[status]
        const label = status === 'converted' ? convertedLabel : STATUS_LABEL[status]
        return (
          <div key={status} style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
            <div style={{
              padding: '8px 10px', borderRadius: 6, fontSize: 12, fontWeight: 800,
              background: sc.bg, color: sc.fg, textTransform: 'uppercase', letterSpacing: '.04em',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span>{label}</span>
              <span style={{ opacity: .8, fontWeight: 700 }}>{list.length}</span>
            </div>
            {list.length === 0 && (
              <div style={{ fontSize: 11, color: 'var(--mist)', padding: '8px 4px', fontStyle: 'italic' }}>
                Empty
              </div>
            )}
            {list.map(l => <LeadCard key={l.id} lead={l} usersById={usersById} convertedLabel={convertedLabel} onOpen={onOpen} compact />)}
          </div>
        )
      })}
    </div>
  )
}

/* ── Card (used by both views) ───────────────────────────── */

function LeadCard({ lead, usersById, convertedLabel, onOpen, compact }: {
  lead: Lead
  usersById: Map<string, any>
  convertedLabel: string
  onOpen: (id: string) => void
  compact?: boolean
}) {
  const sc = STATUS_COLOR[lead.status]
  const rep = lead.assigned_rep_id ? usersById.get(lead.assigned_rep_id) : null
  const headline = lead.company_name || `${lead.first_name} ${lead.last_name}`.trim()
  const subline = lead.company_name
    ? `${lead.first_name} ${lead.last_name}`.trim() + (lead.title ? ` · ${lead.title}` : '')
    : lead.title || ''
  const where = [lead.city, lead.state].filter(Boolean).join(', ')
  const statusLabel = lead.status === 'converted' ? convertedLabel : STATUS_LABEL[lead.status]

  return (
    <button
      onClick={() => onOpen(lead.id)}
      className="card"
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        padding: compact ? '10px 12px' : '12px 16px', cursor: 'pointer', fontFamily: 'inherit',
        background: '#fff',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: compact ? 13 : 14, fontWeight: 800, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {headline}
            {lead.interest_level && (
              <span style={{ marginLeft: 6 }} title={lead.interest_level}>{INTEREST_ICON[lead.interest_level]}</span>
            )}
          </div>
          {subline && (
            <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {subline}
            </div>
          )}
          {where && (
            <div style={{ fontSize: 11, color: 'var(--ash)', marginTop: 2 }}>
              {where}
            </div>
          )}
          {!compact && (lead.email || lead.phone || lead.store_phone) && (
            <div style={{ fontSize: 11, color: 'var(--ash)', marginTop: 2 }}>
              {[lead.email, lead.phone || lead.store_phone].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
        {!compact && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <span style={{
              background: sc.bg, color: sc.fg,
              padding: '2px 10px', borderRadius: 999,
              fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap',
              textTransform: 'uppercase', letterSpacing: '.04em',
            }}>{statusLabel}</span>
            {rep && (
              <span style={{ fontSize: 11, color: 'var(--mist)' }}>{rep.name}</span>
            )}
          </div>
        )}
      </div>
      {compact && rep && (
        <div style={{ fontSize: 10, color: 'var(--mist)', marginTop: 4 }}>{rep.name}</div>
      )}
    </button>
  )
}
