'use client'

// Buying Events — Hub view ("View 1" from the mockups).
//
// Per-event hub card with phase-colored hero, KPI strip, and an
// action-launcher grid. Each launcher opens its function (modal or
// page nav). The user can hide non-essential launchers via the
// "✏️ Customize buttons" modal in the page header; the choice
// persists per-user via users.preferences.
//
// Locked-on launchers (always visible, never hideable):
//   day_entry, buyers, promote
//
// Data fetching mirrors PreEventTab so KPIs and gate counts match
// what the user sees on the existing New view.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useApp } from '@/lib/context'
import { eventEndIso, formatEventRange } from '@/lib/eventDates'
import { eventDisplayName } from '@/lib/eventName'
import { eventSpend } from '@/lib/eventSpend'
import type { Event, EventPromotionalAssetOrder, Store } from '@/types'
import type { NavPage } from '@/app/page'
import {
  EventReadinessCard,
  type CampaignRow,
  type TravelRow,
  type TravelAckRow,
} from './PreEventTab'
import CancelEventModal from './CancelEventModal'
import EventNotesPanel from './EventNotesPanel'
import Checkbox from '@/components/ui/Checkbox'
import { CALENDAR_COLORS } from '@/lib/calendarColors'

// ── Launcher catalog ─────────────────────────────────────────
//
// `locked` keys are always shown (and the customize modal greys
// them out). `requires` controls per-event visibility (e.g. promote
// only on reserved). `adminOnly` hides for non-admins.
type LauncherKey =
  | 'day_entry' | 'buyers' | 'travel' | 'marketing' | 'brief'
  | 'notes' | 'assets' | 'checklist' | 'ad_spend'
  | 'promote' | 'cancel'

interface LauncherDef {
  key: LauncherKey
  icon: string
  label: string
  sub?: string
  locked?: boolean
  adminOnly?: boolean
  /** When set, only renders when this predicate returns true. */
  showWhen?: (ctx: { reserved: boolean; live: boolean }) => boolean
}

const LAUNCHERS: LauncherDef[] = [
  { key: 'day_entry', icon: '📊', label: 'Day Entry',          locked: true,
    showWhen: ({ reserved }) => !reserved,
    sub: "Today's data" },
  { key: 'buyers',    icon: '👥', label: 'Buyers',             locked: true,
    sub: 'Assigned roster' },
  { key: 'promote',   icon: '✅', label: 'Promote to Booked',  locked: true, adminOnly: true,
    showWhen: ({ reserved }) => reserved,
    sub: 'Reserved → Booked' },
  { key: 'travel',    icon: '✈️', label: 'Travel',
    sub: 'Flights, hotels, cars' },
  { key: 'marketing', icon: '📣', label: 'Marketing',
    sub: 'VDP, postcards, comms' },
  { key: 'assets',    icon: '📦', label: 'Assets',
    sub: 'Signage, printables' },
  { key: 'brief',     icon: '🎓', label: 'Brief Staff', adminOnly: true,
    sub: 'Pre-event walkthrough' },
  { key: 'checklist', icon: '📋', label: 'Checklist',
    sub: 'All readiness gates' },
  { key: 'notes',     icon: '📝', label: 'Notes',
    sub: 'Lessons learned' },
  { key: 'ad_spend',  icon: '💰', label: 'Ad Spend',
    sub: 'Paid social spend' },
  { key: 'cancel',    icon: '🚫', label: 'Cancel', adminOnly: true,
    sub: 'Soft-cancel event' },
]

// Avatar palette — rotated by index for stable per-buyer color.
const AVATAR_COLORS = ['#2A8A8A', '#1D6B44', '#3B82F6', '#C97A1F', '#7C3AED', '#0EA5E9', '#EC4899', '#84CC16']
function avatarColor(buyerId: string): string {
  let h = 0
  for (let i = 0; i < buyerId.length; i++) h = (h * 31 + buyerId.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}
function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// ── Component ────────────────────────────────────────────────
export default function HubView({ setNav }: { setNav?: (n: NavPage) => void }) {
  const ctx = useApp()
  const { stores, user, brand, users, setTravelIntent, setDayEntryIntent, reload } = ctx

  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin' || user?.is_partner === true
  const canCancel = user?.role === 'superadmin' || user?.is_partner === true

  const [events, setEvents] = useState<Event[]>([])
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([])
  const [travel, setTravel] = useState<TravelRow[]>([])
  const [travelAcks, setTravelAcks] = useState<TravelAckRow[]>([])
  const [bookingConfigs, setBookingConfigs] = useState<{ store_id: string; day1_start: string | null }[]>([])
  const [assetOrders, setAssetOrders] = useState<EventPromotionalAssetOrder[]>([])
  const [loading, setLoading] = useState(true)

  // Modal state
  const [cancelEventId, setCancelEventId] = useState<string | null>(null)
  const [notesEventId, setNotesEventId] = useState<string | null>(null)
  const [manageEventId, setManageEventId] = useState<string | null>(null)
  const [customizeOpen, setCustomizeOpen] = useState(false)

  // Per-user hidden-launchers list. Lives in users.preferences.buying_events_hub_hidden_launchers.
  const hiddenFromPrefs: LauncherKey[] = useMemo(() => {
    const arr = (user?.preferences as any)?.buying_events_hub_hidden_launchers
    return Array.isArray(arr) ? arr.filter((k: string): k is LauncherKey =>
      LAUNCHERS.some(l => l.key === k && !l.locked)
    ) : []
  }, [user?.preferences])
  const [hidden, setHidden] = useState<Set<LauncherKey>>(new Set(hiddenFromPrefs))
  useEffect(() => { setHidden(new Set(hiddenFromPrefs)) }, [hiddenFromPrefs])

  // Fetch readiness data (mirrors PreEventTab).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      const [evRes, campaignsRes, travelRes, ackRes, bookingRes, assetsRes] = await Promise.all([
        supabase.from('events').select('*').eq('brand', brand).order('start_date'),
        supabase.from('marketing_campaigns').select('event_id, flow_type, status, paid_at'),
        supabase.from('travel_reservations').select('event_id, buyer_id, type'),
        supabase.from('travel_acknowledgments').select('event_id, buyer_id, type'),
        supabase.from('booking_config').select('store_id, day1_start'),
        supabase.from('event_promotional_asset_orders').select('*'),
      ])
      if (cancelled) return
      if (evRes.data) setEvents(evRes.data.map((e: any) => ({ ...e, days: e.days || [] })))
      if (campaignsRes.data) setCampaigns(campaignsRes.data as CampaignRow[])
      if (travelRes.data) setTravel(travelRes.data as TravelRow[])
      if (ackRes.data) setTravelAcks(ackRes.data as TravelAckRow[])
      if (bookingRes.data) setBookingConfigs(bookingRes.data as any[])
      if (assetsRes.data) setAssetOrders(assetsRes.data as EventPromotionalAssetOrder[])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [brand])

  const upcoming = useMemo(() => {
    const todayIso = new Date().toISOString().slice(0, 10)
    return events
      .filter(e => e.status !== 'cancelled')
      .filter(e => !!e.start_date && eventEndIso(e.start_date) >= todayIso)
      .sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''))
  }, [events])

  const campaignsByEvent = useMemo(() => {
    const m = new Map<string, CampaignRow[]>()
    for (const c of campaigns) {
      const arr = m.get(c.event_id) || []; arr.push(c); m.set(c.event_id, arr)
    }
    return m
  }, [campaigns])

  const travelByEvent = useMemo(() => {
    const m = new Map<string, TravelRow[]>()
    for (const t of travel) {
      const arr = m.get(t.event_id) || []; arr.push(t); m.set(t.event_id, arr)
    }
    return m
  }, [travel])

  const acksByEvent = useMemo(() => {
    const m = new Map<string, TravelAckRow[]>()
    for (const a of travelAcks) {
      const arr = m.get(a.event_id) || []; arr.push(a); m.set(a.event_id, arr)
    }
    return m
  }, [travelAcks])

  async function saveHidden(next: Set<LauncherKey>) {
    setHidden(next)
    if (!user?.id) return
    const nextPrefs = { ...(user.preferences || {}), buying_events_hub_hidden_launchers: Array.from(next) }
    const { error } = await supabase.from('users').update({ preferences: nextPrefs }).eq('id', user.id)
    if (error) {
      console.error('Failed to save hub launcher prefs', error)
      return
    }
    // Refresh AppContext.user so other components see the change.
    void reload(brand)
  }

  function toggleHidden(key: LauncherKey) {
    const def = LAUNCHERS.find(l => l.key === key)
    if (!def || def.locked) return
    const next = new Set(hidden)
    if (next.has(key)) next.delete(key); else next.add(key)
    void saveHidden(next)
  }

  async function promoteEvent(ev: Event) {
    if (!confirm(`Promote ${eventDisplayName(ev, stores)} from Reserved → Booked?`)) return
    const { error } = await supabase.from('events').update({ status: 'scheduled' }).eq('id', ev.id)
    if (error) { alert(error.message); return }
    setEvents(es => es.map(e => e.id === ev.id ? { ...e, status: 'scheduled' } : e))
  }

  async function toggleBriefed(ev: Event) {
    const briefed = !!(ev as any).staff_briefed_at
    const ok = briefed
      ? confirm(`Un-mark staff as briefed for "${eventDisplayName(ev, stores)}"?`)
      : confirm(`Mark staff as briefed for "${eventDisplayName(ev, stores)}"?`)
    if (!ok) return
    const update = briefed
      ? { staff_briefed_at: null, staff_briefed_by_user_id: null }
      : { staff_briefed_at: new Date().toISOString(), staff_briefed_by_user_id: user?.id || null }
    const { error } = await supabase.from('events').update(update).eq('id', ev.id)
    if (error) { alert(error.message); return }
    setEvents(es => es.map(e => e.id === ev.id ? { ...e, ...update } as Event : e))
  }

  if (loading) {
    return <div style={{ padding: 24, color: 'var(--mist)', fontSize: 13 }}>Loading hub…</div>
  }

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 10, flexWrap: 'wrap', marginBottom: 14,
      }}>
        <div style={{ color: 'var(--mist)', fontSize: 13 }}>
          One card per event. Click any launcher to open its function.
        </div>
        <button
          onClick={() => setCustomizeOpen(true)}
          className="btn-outline btn-sm"
          title="Show or hide action-launcher buttons across every card"
        >✏️ Customize buttons</button>
      </div>

      {upcoming.length === 0 && (
        <div style={{
          background: '#fff', border: '1px solid var(--cream2)', borderRadius: 10,
          padding: 32, textAlign: 'center', color: 'var(--mist)', fontSize: 14,
        }}>
          No upcoming buying events.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 21 }}>
        {upcoming.map(ev => (
          <HubCard
            key={ev.id}
            ev={ev}
            stores={stores}
            campaigns={campaignsByEvent.get(ev.id) || []}
            travel={travelByEvent.get(ev.id) || []}
            acks={acksByEvent.get(ev.id) || []}
            isAdmin={isAdmin}
            canCancel={canCancel}
            hidden={hidden}
            onLauncher={(key) => {
              switch (key) {
                case 'day_entry': {
                  // Pick the most reasonable day to land on: today's day index
                  // when in-window, otherwise day 1.
                  const todayIso = new Date().toISOString().slice(0, 10)
                  let day = 1
                  if (ev.start_date) {
                    const start = new Date(ev.start_date + 'T12:00:00')
                    const today = new Date(todayIso + 'T12:00:00')
                    const diff = Math.floor((today.getTime() - start.getTime()) / 86_400_000)
                    if (diff >= 0 && diff <= 2) day = diff + 1
                  }
                  setDayEntryIntent({ eventId: ev.id, day, mode: 'buyer' })
                  setNav?.('dayentry')
                  break
                }
                case 'buyers':    setManageEventId(ev.id); break
                case 'travel':    setTravelIntent({ eventId: ev.id }); setNav?.('travel'); break
                case 'marketing': setNav?.('marketing'); break
                case 'brief':     void toggleBriefed(ev); break
                case 'notes':     setNotesEventId(ev.id); break
                case 'assets':    setManageEventId(ev.id); break
                case 'checklist': setManageEventId(ev.id); break
                case 'ad_spend':  setNav?.('marketing'); break
                case 'promote':   void promoteEvent(ev); break
                case 'cancel':    setCancelEventId(ev.id); break
              }
            }}
          />
        ))}
      </div>

      {cancelEventId && (
        <CancelEventModal
          eventId={cancelEventId}
          onClose={() => setCancelEventId(null)}
          onCancelled={() => setEvents(prev => prev.filter(e => e.id !== cancelEventId))}
        />
      )}

      {notesEventId && (() => {
        const ev = events.find(e => e.id === notesEventId)
        const store = stores.find(s => s.id === ev?.store_id)
        if (!ev) return null
        return (
          <EventNotesPanel
            event={ev}
            store={store}
            onClose={() => setNotesEventId(null)}
            onNotesChanged={() => { /* no local view depends on notes count yet */ }}
          />
        )
      })()}

      {manageEventId && (() => {
        const ev = events.find(e => e.id === manageEventId)
        if (!ev) return null
        return (
          <ManageEventModal
            ev={ev}
            stores={stores}
            allEvents={events}
            allUsers={users}
            isAdmin={isAdmin}
            canCancel={canCancel}
            currentUserId={user?.id}
            currentUserName={user?.name || null}
            campaigns={campaignsByEvent.get(ev.id) || []}
            travel={travelByEvent.get(ev.id) || []}
            travelAcks={acksByEvent.get(ev.id) || []}
            assetOrders={assetOrders.filter(o => o.event_id === ev.id)}
            bookingLive={bookingConfigs.some(b => b.store_id === ev.store_id && !!b.day1_start)}
            setNav={setNav}
            onClose={() => setManageEventId(null)}
            onPromoted={(id) => setEvents(es => es.map(e => e.id === id ? { ...e, status: 'scheduled' } : e))}
            onWorkersChange={(workers) => setEvents(prev => prev.map(e => e.id === ev.id ? { ...e, workers } as Event : e))}
            onCancelClick={() => { setManageEventId(null); setCancelEventId(ev.id) }}
            onAssetsChange={(next) => setAssetOrders(prev => {
              const others = prev.filter(o => o.event_id !== ev.id)
              return [...others, ...next]
            })}
          />
        )
      })()}

      {customizeOpen && (
        <CustomizeModal
          hidden={hidden}
          onToggle={toggleHidden}
          onClose={() => setCustomizeOpen(false)}
        />
      )}
    </div>
  )
}

// ── Hub card ─────────────────────────────────────────────────

function HubCard({
  ev, stores, campaigns, travel, acks,
  isAdmin, canCancel, hidden, onLauncher,
}: {
  ev: Event
  stores: Store[]
  campaigns: CampaignRow[]
  travel: TravelRow[]
  acks: TravelAckRow[]
  isAdmin: boolean
  canCancel: boolean
  hidden: Set<LauncherKey>
  onLauncher: (k: LauncherKey) => void
}) {
  const store = stores.find(s => s.id === ev.store_id)
  const display = eventDisplayName(ev, stores)
  const reserved = ev.status === 'reserved'
  const range = ev.start_date ? formatEventRange(ev.start_date) : ''

  const todayIso = new Date().toISOString().slice(0, 10)
  const startIso = ev.start_date || ''
  const endIso = ev.start_date ? eventEndIso(ev.start_date) : ''
  const live = !reserved && startIso <= todayIso && endIso >= todayIso
  const soon = !reserved && !live && startIso > todayIso &&
    (new Date(startIso).getTime() - new Date(todayIso).getTime()) <= 7 * 86_400_000

  // Phase tag for hero
  const phase: 'live' | 'soon' | 'upcoming' | 'reserved' =
    reserved ? 'reserved' : live ? 'live' : soon ? 'soon' : 'upcoming'

  const heroBg =
    phase === 'live'      ? 'linear-gradient(160deg, #1E40AF 0%, #38BDF8 100%)' :
    phase === 'soon'      ? 'linear-gradient(160deg, #1E40AF 0%, #38BDF8 100%)' :
    phase === 'reserved'  ? 'linear-gradient(160deg, #92400E 0%, #D97706 100%)' :
                            'linear-gradient(160deg, #14532D 0%, #1D6B44 100%)'

  const phasePill =
    phase === 'live'     ? `Live · Day ${dayIndex(startIso, todayIso) + 1}` :
    phase === 'soon'     ? `In ${daysBetween(todayIso, startIso)} day${daysBetween(todayIso, startIso) === 1 ? '' : 's'}` :
    phase === 'reserved' ? 'Save the Date' :
                           `In ${daysBetween(todayIso, startIso)} days`

  // KPIs
  const days = ev.days || []
  const spent = eventSpend(ev)
  const customers = days.reduce((s, d: any) => s + (d.customers || 0), 0)
  const workers = (ev.workers || []).filter((w: any) => !w.deleted)
  const buyersNeeded = ev.buyers_needed ?? null

  // Open gates count — quick approximation matching PreEventTab semantics:
  //   buyers short, travel rows missing, marketing flows not done, brief not done.
  const buyersShort = buyersNeeded != null ? Math.max(0, buyersNeeded - workers.length) : 0
  const travelMissing = workers.reduce((acc, w) => {
    const has = (kind: string) => travel.some(t => t.buyer_id === w.id && t.type === kind)
              || acks.some(a => a.buyer_id === w.id && (a.type === `self_${kind}` || a.type === `no_${kind}`))
    return acc + (has('flight') && has('hotel') ? 0 : 1)
  }, 0)
  const marketingMissing = (() => {
    const flows: Array<'vdp' | 'postcard' | 'newspaper'> = ['vdp', 'postcard', 'newspaper']
    return flows.filter(f => !campaigns.some(c => c.flow_type === f && c.status === 'done')).length
  })()
  const briefMissing = !((ev as any).staff_briefed_at) && !reserved ? 1 : 0
  const openGates = buyersShort + travelMissing + marketingMissing + briefMissing

  return (
    <div style={{
      background: '#fff',
      border: `1px solid ${reserved ? CALENDAR_COLORS.buying.main : 'var(--cream2)'}`,
      borderStyle: reserved ? 'dashed' : 'solid',
      borderRadius: 14, overflow: 'hidden',
    }}>
      {/* Hero — 15% shorter than original (padding + line gaps tightened) */}
      <div style={{ padding: '12px 22px', background: heroBg, color: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 19, fontWeight: 900, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', lineHeight: 1.2 }}>
              {reserved && <span aria-hidden>📌</span>}
              {display}
              <span style={{
                display: 'inline-block', padding: '3px 10px', borderRadius: 99,
                background: 'rgba(255,255,255,.2)', fontSize: 11, fontWeight: 800,
                textTransform: 'uppercase', letterSpacing: '.04em',
              }}>{phasePill}</span>
            </div>
            <div style={{ color: 'rgba(255,255,255,.85)', fontSize: 12.5, marginTop: 2 }}>
              {store?.city}{store?.state ? `, ${store.state}` : ''} · 📅 {range}
            </div>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        borderBottom: '1px solid var(--cream2)', background: 'var(--cream)',
      }}>
        <Kpi label="Spent" value={fmtMoney(spent)} good={spent > 0} />
        <Kpi label="Customers" value={String(customers)} />
        <Kpi
          label="Buyers"
          value={`${workers.length}${buyersNeeded != null ? `/${buyersNeeded}` : ''}`}
          warn={buyersNeeded != null && workers.length < buyersNeeded}
        />
        <Kpi
          label={openGates > 0 ? '⚠ Open gates' : 'Status'}
          value={openGates > 0 ? String(openGates) : (reserved ? '📌 Reserved' : 'Ready')}
          warn={openGates > 0}
          good={openGates === 0 && !reserved}
        />
      </div>

      {/* Launcher grid */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: 8, padding: 14, background: '#fff',
      }}>
        {LAUNCHERS.map(def => {
          if (hidden.has(def.key) && !def.locked) return null
          if (def.adminOnly && !isAdmin) return null
          if (def.key === 'cancel' && !canCancel) return null
          if (def.showWhen && !def.showWhen({ reserved, live })) return null
          return (
            <Launcher
              key={def.key}
              def={def}
              ev={ev}
              workers={workers}
              campaigns={campaigns}
              travel={travel}
              acks={acks}
              briefed={!!(ev as any).staff_briefed_at}
              onClick={() => onLauncher(def.key)}
            />
          )
        })}
      </div>
    </div>
  )
}

function Kpi({ label, value, warn, good }: { label: string; value: string; warn?: boolean; good?: boolean }) {
  return (
    <div style={{ padding: '14px 18px', borderRight: '1px solid var(--cream2)' }}>
      <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--mist)' }}>{label}</div>
      <div style={{
        fontSize: 20, fontWeight: 900, marginTop: 2,
        color: warn ? '#92400e' : good ? 'var(--green-dark)' : 'var(--ink)',
      }}>{value}</div>
    </div>
  )
}

function Launcher({
  def, ev, workers, campaigns, travel, acks, briefed, onClick,
}: {
  def: LauncherDef
  ev: Event
  workers: { id: string; name: string }[]
  campaigns: CampaignRow[]
  travel: TravelRow[]
  acks: TravelAckRow[]
  briefed: boolean
  onClick: () => void
}) {
  // Per-launcher subtitle / inline content
  let subRender: React.ReactNode = def.sub
  let primary = def.key === 'promote'
  let danger = def.key === 'cancel'

  if (def.key === 'buyers') {
    subRender = workers.length === 0
      ? <small style={{ display: 'block', fontSize: 10, color: 'var(--mist)', fontWeight: 600, marginTop: 2 }}>No buyers yet</small>
      : <span style={{ display: 'inline-flex', alignItems: 'center', marginTop: 4 }}>
          {workers.slice(0, 5).map((w, i) => (
            <span
              key={w.id}
              title={w.name}
              style={{
                width: 20, height: 20, borderRadius: '50%',
                background: avatarColor(w.id), color: '#fff',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9, fontWeight: 800, border: '1.5px solid #fff',
                marginLeft: i === 0 ? 0 : -7,
                boxShadow: '0 0 0 1px rgba(0,0,0,.05)',
              }}
            >{initials(w.name)}</span>
          ))}
          {workers.length > 5 && (
            <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--mist)', fontWeight: 700 }}>
              +{workers.length - 5}
            </span>
          )}
        </span>
  } else if (def.key === 'travel') {
    const covered = workers.filter(w => {
      const has = (k: string) => travel.some(t => t.buyer_id === w.id && t.type === k)
        || acks.some(a => a.buyer_id === w.id && (a.type === `self_${k}` || a.type === `no_${k}`))
      return has('flight') && has('hotel')
    }).length
    subRender = workers.length === 0 ? '—' : `${covered}/${workers.length} covered`
  } else if (def.key === 'marketing') {
    const done = (['vdp', 'postcard', 'newspaper'] as const)
      .filter(f => campaigns.some(c => c.flow_type === f && c.status === 'done')).length
    subRender = `${done}/3 done`
  } else if (def.key === 'brief') {
    subRender = briefed ? '✓ Briefed' : 'Not briefed yet'
  } else if (def.key === 'day_entry') {
    const enteredDays = (ev.days || []).filter((d: any) => d.entered_at).length
    subRender = enteredDays === 0 ? "Today's data" : `${enteredDays}/${(ev.days || []).length || 3} entered`
  }

  const sub = typeof subRender === 'string'
    ? <small style={{ display: 'block', fontSize: 10, color: 'var(--mist)', fontWeight: 600, marginTop: 2 }}>{subRender}</small>
    : subRender

  return (
    <button
      onClick={onClick}
      style={{
        background: primary ? 'var(--green-pale)' : 'var(--cream)',
        border: `1px solid ${primary ? 'var(--green3)' : 'var(--pearl)'}`,
        borderRadius: 8, padding: '12px 14px', textAlign: 'left',
        display: 'flex', alignItems: 'center', gap: 10,
        fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
        color: primary ? 'var(--green-dark)' : danger ? '#B22234' : 'var(--ink)',
        cursor: 'pointer',
      }}
    >
      <span style={{ fontSize: 18, lineHeight: 1 }} aria-hidden>{def.icon}</span>
      <span>
        {def.label}
        {sub}
      </span>
    </button>
  )
}

// ── Customize-buttons modal ──────────────────────────────────

function CustomizeModal({
  hidden, onToggle, onClose,
}: { hidden: Set<LauncherKey>; onToggle: (k: LauncherKey) => void; onClose: () => void }) {
  const hiddenCount = Array.from(hidden).length
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20, zIndex: 1000,
      }}
    >
      <div style={{
        background: '#fff', borderRadius: 14, maxWidth: 520, width: '100%',
        maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.3)',
      }}>
        <div style={{
          padding: '18px 22px', borderBottom: '1px solid var(--cream2)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <h3 style={{ margin: 0, fontSize: 17 }}>✏️ Customize launcher buttons</h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 0, fontSize: 22, color: 'var(--mist)', cursor: 'pointer' }} aria-label="Close">×</button>
        </div>
        <div style={{ padding: '18px 22px' }}>
          <p style={{ color: 'var(--ash)', fontSize: 13, margin: '0 0 14px', lineHeight: 1.5 }}>
            Show or hide each launcher across every event card. Setting saves to your account so it
            stays the same on every device.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {LAUNCHERS.map(l => {
              const isVisible = !(hidden.has(l.key) && !l.locked)
              return (
                <div
                  key={l.key}
                  onClick={() => !l.locked && onToggle(l.key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 12px', background: 'var(--cream)',
                    border: '1px solid var(--pearl)', borderRadius: 8,
                    cursor: l.locked ? 'not-allowed' : 'pointer',
                    opacity: l.locked ? 0.55 : 1,
                  }}
                >
                  <Checkbox
                    checked={isVisible}
                    disabled={l.locked}
                    onChange={() => !l.locked && onToggle(l.key)}
                  />
                  <span style={{ fontSize: 18 }}>{l.icon}</span>
                  <span style={{ flex: 1 }}>
                    <span style={{ display: 'block', fontWeight: 800, fontSize: 13 }}>{l.label}</span>
                    {l.sub && <span style={{ display: 'block', fontSize: 11, color: 'var(--mist)' }}>{l.sub}</span>}
                  </span>
                  {l.locked && (
                    <span style={{
                      fontSize: 10, background: 'var(--cream2)', color: 'var(--ash)',
                      padding: '2px 7px', borderRadius: 99, fontWeight: 800,
                      textTransform: 'uppercase', letterSpacing: '.04em',
                    }}>🔒 Always</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
        <div style={{
          padding: '14px 22px', borderTop: '1px solid var(--cream2)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: 12, color: 'var(--mist)' }}>
            {hiddenCount === 0 ? 'All buttons visible' : `${hiddenCount} button${hiddenCount === 1 ? '' : 's'} hidden`}
          </span>
          <button onClick={onClose} className="btn-primary btn-sm">Done</button>
        </div>
      </div>
    </div>
  )
}

// ── Manage-event modal (full readiness card) ─────────────────

function ManageEventModal(props: {
  ev: Event
  stores: Store[]
  allEvents: Event[]
  allUsers: { id: string; name: string }[] | undefined
  isAdmin: boolean
  canCancel: boolean
  currentUserId: string | undefined
  currentUserName: string | null
  campaigns: CampaignRow[]
  travel: TravelRow[]
  travelAcks: TravelAckRow[]
  assetOrders: EventPromotionalAssetOrder[]
  bookingLive: boolean
  setNav?: (n: NavPage) => void
  onClose: () => void
  onPromoted: (id: string) => void
  onWorkersChange: (workers: { id: string; name: string }[]) => void
  onCancelClick: () => void
  onAssetsChange: (next: EventPromotionalAssetOrder[]) => void
}) {
  const { ev, onClose } = props
  const [assetEditorOpen, setAssetEditorOpen] = useState(false)
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: 20, zIndex: 999, overflow: 'auto',
      }}
    >
      <div style={{
        background: 'var(--cream)', borderRadius: 14, maxWidth: 880, width: '100%',
        marginTop: 20, marginBottom: 20, padding: 20,
        boxShadow: '0 20px 60px rgba(0,0,0,.3)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button onClick={onClose} style={{
            background: '#fff', border: '1px solid var(--pearl)', borderRadius: 6,
            padding: '6px 12px', cursor: 'pointer', fontWeight: 700, fontSize: 12,
            fontFamily: 'inherit',
          }}>Close ×</button>
        </div>
        <EventReadinessCard
          ev={ev}
          campaigns={props.campaigns}
          travel={props.travel}
          travelAcks={props.travelAcks}
          assetOrders={props.assetOrders}
          bookingLive={props.bookingLive}
          lastLesson={null}
          allEvents={props.allEvents}
          stores={props.stores}
          isAdmin={props.isAdmin}
          canCancel={props.canCancel}
          currentUserId={props.currentUserId}
          currentUserName={props.currentUserName}
          setNav={props.setNav}
          onOpenTravel={() => { /* outer Travel intent already wired from launcher */ }}
          onPromoted={props.onPromoted}
          onAssetEdit={() => setAssetEditorOpen(true)}
          onMarkBriefed={async () => { /* mirrored via supabase from PreEventTab — no-op here */ }}
          onSetOverride={async () => { /* PreEventTab semantics; intentionally no-op in modal */ }}
          onCarriedForward={() => { /* notes carry-forward only matters in PreEventTab */ }}
          onCancelClick={props.onCancelClick}
          allUsers={props.allUsers as any}
          onWorkersChange={props.onWorkersChange}
        />
      </div>
    </div>
  )
}

// ── helpers ───────────────────────────────────────────────────

function dayIndex(startIso: string, todayIso: string): number {
  if (!startIso) return 0
  const start = new Date(startIso + 'T12:00:00').getTime()
  const today = new Date(todayIso + 'T12:00:00').getTime()
  return Math.max(0, Math.min(2, Math.floor((today - start) / 86_400_000)))
}
function daysBetween(fromIso: string, toIso: string): number {
  const f = new Date(fromIso + 'T12:00:00').getTime()
  const t = new Date(toIso + 'T12:00:00').getTime()
  return Math.max(0, Math.round((t - f) / 86_400_000))
}
function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}
