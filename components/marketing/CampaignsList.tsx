'use client'

// Top-level campaign list — every event's marketing campaigns across
// all flow types, filterable by flow + status + store + at-risk. Click
// a row to open CampaignDetail.
//
// Spec section 1 ("Marketing Section Rework"): list of recent marketing
// campaigns across all events, filterable by flow type, status, store,
// and event date.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type { MarketingCampaign, MarketingFlowType, MarketingStatus, Event } from '@/types'
import CampaignDetail from './CampaignDetail'

type FlowFilter = 'all' | MarketingFlowType
type StatusFilter = 'all' | MarketingStatus | 'at_risk'

const FLOW_LABELS: Record<MarketingFlowType, string> = {
  vdp: '📬 VDP',
  postcard: '📮 Postcard',
  newspaper: '📰 Newspaper',
}

const STATUS_LABELS: Record<MarketingStatus, { label: string; color: string }> = {
  setup:    { label: 'Setup',    color: 'var(--silver)' },
  planning: { label: 'Planning', color: '#f59e0b' },
  proofing: { label: 'Proofing', color: '#3b82f6' },
  payment:  { label: 'Payment',  color: '#a855f7' },
  done:     { label: 'Done',     color: 'var(--green-dark)' },
}

const AT_RISK_DAYS = 3 // mail_by - 3 days = warning threshold

export default function CampaignsList() {
  const { events, stores } = useApp()
  const [campaigns, setCampaigns] = useState<MarketingCampaign[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)

  // Filters
  const [flow, setFlow] = useState<FlowFilter>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('marketing_campaigns')
      .select('*')
      .order('created_at', { ascending: false })
    setCampaigns((data ?? []) as MarketingCampaign[])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const eventById = useMemo(() => new Map(events.map(e => [e.id, e])), [events])
  const storeById = useMemo(() => new Map(stores.map(s => [s.id, s])), [stores])

  const today = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d
  }, [])

  // Apply filters. Sort: in-progress upcoming first, then done, then setup.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return campaigns
      .filter(c => {
        if (flow !== 'all' && c.flow_type !== flow) return false
        if (status === 'at_risk') {
          if (!c.mail_by_date || c.status === 'payment' || c.status === 'done') return false
          const mailBy = new Date(c.mail_by_date + 'T12:00:00')
          const diffDays = Math.round((mailBy.getTime() - today.getTime()) / 86400000)
          if (diffDays > AT_RISK_DAYS) return false
        } else if (status !== 'all' && c.status !== status) return false
        if (q) {
          const ev = eventById.get(c.event_id)
          const storeName = ev ? (storeById.get(ev.store_id)?.name || ev.store_name) : ''
          if (!(storeName || '').toLowerCase().includes(q)) return false
        }
        return true
      })
      .sort((a, b) => {
        const evA = eventById.get(a.event_id)
        const evB = eventById.get(b.event_id)
        // Sort by event start_date desc (newest events first)
        const da = evA?.start_date || ''
        const db = evB?.start_date || ''
        if (da !== db) return db.localeCompare(da)
        return a.flow_type.localeCompare(b.flow_type)
      })
  }, [campaigns, flow, status, search, today, eventById, storeById])

  if (openId) {
    const c = campaigns.find(x => x.id === openId)
    if (c) {
      return (
        <CampaignDetail
          campaign={c}
          onBack={() => setOpenId(null)}
          onChanged={(next) => setCampaigns(p => p.map(x => x.id === next.id ? next : x))}
          onDeleted={(id) => { setCampaigns(p => p.filter(x => x.id !== id)); setOpenId(null) }}
        />
      )
    }
  }

  return (
    <div>
      {/* Filters */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14, alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search store…"
          style={{ width: 220, fontSize: 13 }} />
        <FilterChips
          options={[['all', 'All flows'], ['vdp', 'VDP'], ['postcard', 'Postcard'], ['newspaper', 'Newspaper']]}
          value={flow}
          onChange={v => setFlow(v as FlowFilter)}
        />
        <FilterChips
          options={[
            ['all', 'All statuses'],
            ['setup', 'Setup'], ['planning', 'Planning'], ['proofing', 'Proofing'],
            ['payment', 'Payment'], ['done', 'Done'],
            ['at_risk', '⚠ At risk'],
          ]}
          value={status}
          onChange={v => setStatus(v as StatusFilter)}
        />
      </div>

      {loading ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--mist)' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--mist)' }}>
          No campaigns match the current filters.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(c => (
            <CampaignRow key={c.id} campaign={c}
              event={eventById.get(c.event_id)}
              storeName={(() => {
                const ev = eventById.get(c.event_id)
                return ev ? (storeById.get(ev.store_id)?.name || ev.store_name || '(unknown)') : '(unknown)'
              })()}
              today={today}
              onOpen={() => setOpenId(c.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function FilterChips<T extends string>({ options, value, onChange }: {
  options: [T, string][]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {options.map(([k, label]) => {
        const sel = value === k
        return (
          <button key={k} onClick={() => onChange(k)} style={{
            padding: '4px 10px', borderRadius: 99,
            border: '1px solid var(--pearl)',
            background: sel ? 'var(--sidebar-bg)' : 'var(--cream)',
            color: sel ? '#fff' : 'var(--ash)',
            fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          }}>{label}</button>
        )
      })}
    </div>
  )
}

function CampaignRow({ campaign: c, event, storeName, today, onOpen }: {
  campaign: MarketingCampaign
  event: Event | undefined
  storeName: string
  today: Date
  onOpen: () => void
}) {
  const sc = STATUS_LABELS[c.status]
  const startDate = event?.start_date
    ? new Date(event.start_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null
  const mailBy = c.mail_by_date
    ? new Date(c.mail_by_date + 'T12:00:00')
    : null
  const daysToMailBy = mailBy ? Math.round((mailBy.getTime() - today.getTime()) / 86400000) : null
  const atRisk = daysToMailBy != null && daysToMailBy <= AT_RISK_DAYS && c.status !== 'payment' && c.status !== 'done'

  return (
    <div onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
      style={{
        background: '#fff', border: '1px solid var(--pearl)', borderRadius: 10,
        padding: '12px 16px', cursor: 'pointer',
        display: 'grid', gridTemplateColumns: '110px 1fr auto auto', gap: 14, alignItems: 'center',
      }}>
      <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--ink)' }}>
        {FLOW_LABELS[c.flow_type]}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {storeName}
        </div>
        <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 2 }}>
          {startDate || '(no event date)'}
          {c.sub_status && <span> · {c.sub_status.replace(/_/g, ' ')}</span>}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        {c.mail_by_date && (
          <div style={{ fontSize: 11, color: atRisk ? '#dc2626' : 'var(--mist)', fontWeight: atRisk ? 800 : 600 }}>
            {atRisk ? '⚠ ' : ''}Mail by {mailBy!.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            {daysToMailBy != null && daysToMailBy >= 0 && (
              <span> ({daysToMailBy === 0 ? 'today' : `${daysToMailBy}d`})</span>
            )}
          </div>
        )}
        {c.marketing_budget && (
          <div style={{ fontSize: 11, color: 'var(--ash)', fontWeight: 700 }}>
            ${Number(c.marketing_budget).toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </div>
        )}
      </div>
      <span style={{
        background: sc.color, color: '#fff',
        padding: '3px 10px', borderRadius: 99,
        fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em',
        whiteSpace: 'nowrap',
      }}>{sc.label}</span>
    </div>
  )
}
