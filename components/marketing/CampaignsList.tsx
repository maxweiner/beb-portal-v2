'use client'

// Top-level marketing campaign list — stripped down to the essentials:
// auto-generated name (store · flow · event date) + status badge +
// at-risk warning. "+ New Campaign" button at the top opens the
// modal. Empty state suggests a quick-start for the most recent
// upcoming event.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type { MarketingCampaign, MarketingFlowType, MarketingStatus, Event } from '@/types'
import CampaignDetail from './CampaignDetail'
import NewCampaignModal from './NewCampaignModal'

const FLOW_LABELS: Record<MarketingFlowType, string> = {
  vdp:       'VDP',
  postcard:  'Postcard',
  newspaper: 'Newspaper',
}

const STATUS_LABELS: Record<MarketingStatus, { label: string; color: string }> = {
  setup:    { label: 'Setup',    color: 'var(--silver)' },
  planning: { label: 'Planning', color: '#f59e0b' },
  proofing: { label: 'Proofing', color: '#3b82f6' },
  payment:  { label: 'Payment',  color: '#a855f7' },
  done:     { label: 'Done',     color: 'var(--green-dark)' },
}

const AT_RISK_DAYS = 3

function isAtRisk(c: MarketingCampaign, today: Date): boolean {
  if (!c.mail_by_date) return false
  if (c.status === 'payment' || c.status === 'done') return false
  const mailBy = new Date(c.mail_by_date + 'T12:00:00')
  const diffDays = Math.round((mailBy.getTime() - today.getTime()) / 86400000)
  return diffDays <= AT_RISK_DAYS
}

function fmtEventDate(iso: string | undefined): string {
  if (!iso) return ''
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function CampaignsList() {
  const { events, stores } = useApp()
  const [campaigns, setCampaigns] = useState<MarketingCampaign[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [showNewModal, setShowNewModal] = useState(false)
  const [quickStartFlow, setQuickStartFlow] = useState<MarketingFlowType | null>(null)

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('marketing_campaigns')
      .select('*').order('created_at', { ascending: false })
    setCampaigns((data ?? []) as MarketingCampaign[])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const eventById = useMemo(() => new Map(events.map(e => [e.id, e])), [events])
  const storeById = useMemo(() => new Map(stores.map(s => [s.id, s])), [stores])
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])

  // Most recent upcoming event for the empty-state quick-start.
  const upcomingEvent = useMemo<Event | null>(() => {
    return [...events]
      .filter(e => e.start_date && new Date(e.start_date + 'T12:00:00') >= today)
      .sort((a, b) => a.start_date.localeCompare(b.start_date))[0] || null
  }, [events, today])

  // Sort: at-risk first, then event start desc.
  const sorted = useMemo(() => {
    return [...campaigns].sort((a, b) => {
      const aRisk = isAtRisk(a, today)
      const bRisk = isAtRisk(b, today)
      if (aRisk !== bRisk) return aRisk ? -1 : 1
      const evA = eventById.get(a.event_id)
      const evB = eventById.get(b.event_id)
      const da = evA?.start_date || ''
      const db = evB?.start_date || ''
      if (da !== db) return db.localeCompare(da)
      return a.flow_type.localeCompare(b.flow_type)
    })
  }, [campaigns, today, eventById])

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: 'var(--mist)' }}>
          {sorted.length === 0 ? 'No campaigns' : `${sorted.length} campaign${sorted.length === 1 ? '' : 's'}`}
        </div>
        <button className="btn-primary btn-sm" onClick={() => { setQuickStartFlow(null); setShowNewModal(true) }}>
          + New Campaign
        </button>
      </div>

      {loading ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--mist)' }}>Loading…</div>
      ) : sorted.length === 0 ? (
        <EmptyState upcomingEvent={upcomingEvent}
          eventLabelFn={(ev) => {
            const store = storeById.get(ev.store_id)
            return `${store?.name || ev.store_name || '(unknown)'} · ${fmtEventDate(ev.start_date)}`
          }}
          onQuickStart={(flow) => {
            setQuickStartFlow(flow)
            setShowNewModal(true)
          }}
          onNewBlank={() => { setQuickStartFlow(null); setShowNewModal(true) }}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {sorted.map(c => {
            const ev = eventById.get(c.event_id)
            const storeName = ev ? (storeById.get(ev.store_id)?.name || ev.store_name || '(unknown)') : '(unknown)'
            const name = `${storeName} · ${FLOW_LABELS[c.flow_type]} · ${fmtEventDate(ev?.start_date)}`
            const sc = STATUS_LABELS[c.status]
            const atRisk = isAtRisk(c, today)
            return (
              <div key={c.id}
                onClick={() => setOpenId(c.id)}
                role="button"
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(c.id) } }}
                style={{
                  background: '#fff', border: '1px solid var(--pearl)', borderRadius: 10,
                  padding: '12px 16px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 12,
                  transition: 'background .12s ease, border-color .12s ease',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'var(--cream)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = '#fff' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {name}
                </div>
                {atRisk && (
                  <span title={`Within ${AT_RISK_DAYS} days of mail-by`}
                    style={{ color: '#dc2626', fontSize: 14, fontWeight: 800 }}>⚠</span>
                )}
                <span style={{
                  background: sc.color, color: '#fff',
                  padding: '3px 10px', borderRadius: 99,
                  fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em',
                  whiteSpace: 'nowrap',
                }}>{sc.label}</span>
              </div>
            )
          })}
        </div>
      )}

      <NewCampaignModal
        open={showNewModal}
        onClose={() => setShowNewModal(false)}
        onCreated={(id) => { setShowNewModal(false); load().then(() => setOpenId(id)) }}
        lockedFlow={quickStartFlow ?? undefined}
        lockedEvent={quickStartFlow && upcomingEvent ? upcomingEvent : undefined}
      />
    </div>
  )
}

function EmptyState({ upcomingEvent, eventLabelFn, onQuickStart, onNewBlank }: {
  upcomingEvent: Event | null
  eventLabelFn: (ev: Event) => string
  onQuickStart: (flow: MarketingFlowType) => void
  onNewBlank: () => void
}) {
  return (
    <div className="card" style={{ padding: 32, textAlign: 'center' }}>
      <div style={{ fontSize: 40, marginBottom: 10 }}>📣</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)', marginBottom: 6 }}>
        No campaigns yet
      </div>
      <div style={{ fontSize: 13, color: 'var(--mist)', marginBottom: 18 }}>
        Click <strong>+ New Campaign</strong> above to start one — or use the shortcuts below.
      </div>

      {upcomingEvent && (
        <div style={{
          background: 'var(--cream)', border: '1px solid var(--pearl)', borderRadius: 8,
          padding: 14, maxWidth: 460, margin: '0 auto 12px',
        }}>
          <div style={{ fontSize: 12, color: 'var(--ash)', marginBottom: 8 }}>
            Start one for the next event:
          </div>
          <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--ink)', marginBottom: 12 }}>
            {eventLabelFn(upcomingEvent)}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn-primary btn-sm" onClick={() => onQuickStart('vdp')}>
              📬 + VDP
            </button>
            <button className="btn-primary btn-sm" onClick={() => onQuickStart('postcard')}>
              📮 + Postcard
            </button>
            <button className="btn-primary btn-sm" onClick={() => onQuickStart('newspaper')}>
              📰 + Newspaper
            </button>
          </div>
        </div>
      )}

      <button className="btn-outline btn-sm" onClick={onNewBlank}>
        + New Campaign (pick event manually)
      </button>
    </div>
  )
}
