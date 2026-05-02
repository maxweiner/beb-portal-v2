'use client'

// Leads top-level page. Phase 6: list, filter, add (manual),
// click-to-detail. Detail view at LeadDetail. Convert-to-trunk-
// show is Phase 16; OCR business card scan is Phase 7.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import { listLeads } from '@/lib/sales/leads'
import type { Lead, LeadInterestLevel, LeadStatus } from '@/types'
import AddLeadModal from './AddLeadModal'
import LeadDetail from './LeadDetail'
import type { NavPage } from '@/app/page'

type StatusFilter = 'all' | LeadStatus
type InterestFilter = 'all' | LeadInterestLevel

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

export default function Leads({ setNav }: { setNav?: (n: NavPage) => void }) {
  const { user, users } = useApp()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin' || !!user?.is_partner

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
  const repOptions = useMemo(() => Array.from(
    new Set(rows.map(r => r.assigned_rep_id).filter(Boolean) as string[])
  ).map(id => ({ id, name: usersById.get(id)?.name || '(unknown)' })), [rows, usersById])

  const filtered = useMemo(() => rows.filter(r => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false
    if (interestFilter !== 'all' && r.interest_level !== interestFilter) return false
    if (repFilter !== 'all' && r.assigned_rep_id !== repFilter) return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      const hay = [
        r.first_name, r.last_name, r.company_name,
        r.email, r.phone, r.city, r.state,
      ].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  }), [rows, statusFilter, interestFilter, repFilter, search])

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
    <div className="p-6" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)' }}>🎯 Leads</h1>
        <button className="btn-primary btn-sm" onClick={() => setCreateOpen(true)}>+ Add Lead</button>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: 12, padding: 12 }}>
        <div style={{
          display: 'grid', gap: 10,
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        }}>
          <div>
            <label className="fl">Search</label>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Name, company, email…" />
          </div>
          <div>
            <label className="fl">Status</label>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusFilter)}>
              <option value="all">All</option>
              <option value="new">New</option>
              <option value="contacted">Contacted</option>
              <option value="converted">Converted</option>
              <option value="dead">Dead</option>
            </select>
          </div>
          <div>
            <label className="fl">Interest</label>
            <select value={interestFilter} onChange={e => setInterestFilter(e.target.value as InterestFilter)}>
              <option value="all">All</option>
              <option value="hot">🔥 Hot</option>
              <option value="warm">🌤️ Warm</option>
              <option value="cold">❄️ Cold</option>
            </select>
          </div>
          {(isAdmin || repOptions.length > 1) && (
            <div>
              <label className="fl">Assigned rep</label>
              <select value={repFilter} onChange={e => setRepFilter(e.target.value)}>
                <option value="all">All reps</option>
                {repOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="card" style={{ padding: 14, marginBottom: 12, background: '#FEE2E2', color: '#991B1B' }}>{error}</div>
      )}

      {!loaded ? (
        <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--mist)' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--mist)' }}>
          {rows.length === 0 ? 'No leads yet. Click "+ Add Lead" to capture one.' : 'No leads match the current filters.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(l => {
            const sc = STATUS_COLOR[l.status]
            const rep = l.assigned_rep_id ? usersById.get(l.assigned_rep_id) : null
            return (
              <button
                key={l.id}
                onClick={() => setOpenId(l.id)}
                className="card"
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '12px 16px', cursor: 'pointer', fontFamily: 'inherit',
                  background: '#fff',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink)' }}>
                      {l.first_name} {l.last_name}
                      {l.interest_level && (
                        <span style={{ marginLeft: 8 }} title={l.interest_level}>{INTEREST_ICON[l.interest_level]}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 2 }}>
                      {l.company_name || '(no company)'}
                      {l.title ? ` · ${l.title}` : ''}
                      {l.city || l.state ? ` · ${[l.city, l.state].filter(Boolean).join(', ')}` : ''}
                    </div>
                    {(l.email || l.phone) && (
                      <div style={{ fontSize: 11, color: 'var(--ash)', marginTop: 2 }}>
                        {l.email}{l.email && l.phone ? ' · ' : ''}{l.phone}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <span style={{
                      background: sc.bg, color: sc.fg,
                      padding: '2px 10px', borderRadius: 999,
                      fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap',
                      textTransform: 'uppercase', letterSpacing: '.04em',
                    }}>{STATUS_LABEL[l.status]}</span>
                    {rep && (
                      <span style={{ fontSize: 11, color: 'var(--mist)' }}>{rep.name}</span>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {createOpen && (
        <AddLeadModal
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
