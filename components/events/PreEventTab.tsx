'use client'

// Pre-Event Readiness — top tab inside BuyingEventsView.
//
// One card per upcoming or in-window event. Each card surfaces the
// gates partners/admins use to decide if the event is ready to run:
//
//   • Save the Date / status     (📌 Reserved → ✅ Promote)
//   • Buyers (assigned vs. needed, with conflict flags)
//   • Travel (per-buyer flight + hotel logged)
//   • Marketing (VDP / postcard / newspaper milestones)
//   • Booking system (store has a configured booking_config)
//   • Counter cards / in-store assets (PR 2.5b)
//   • Staff briefed (PR 2.5b)
//
// "Past events" (3-day window already ended) are excluded — those
// belong on the Post-Event tab. Cancelled events are also excluded.
// Click any chip → cross-nav into the matching module so every
// existing function stays one click away.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useApp } from '@/lib/context'
import { eventEndIso, formatEventRange } from '@/lib/eventDates'
import { eventDisplayName } from '@/lib/eventName'
import type { Event, EventPromotionalAssetOrder } from '@/types'
import type { NavPage } from '@/app/page'

type CampaignRow = {
  event_id: string
  flow_type: 'vdp' | 'postcard' | 'newspaper'
  status: 'setup' | 'planning' | 'proofing' | 'payment' | 'done'
  paid_at: string | null
}

type TravelRow = {
  event_id: string
  buyer_id: string
  type: 'flight' | 'hotel' | 'rental_car'
}

type TravelAckRow = {
  event_id: string
  buyer_id: string
  type: string  // 'self_flight' | 'self_hotel' | 'no_flight' | 'no_hotel' | 'no_rental_car'
}

type BookingRow = { store_id: string; day1_start: string | null }

interface Props {
  setNav?: (n: NavPage) => void
}

export default function PreEventTab({ setNav }: Props) {
  const { stores, events: ctxEvents, user, setTravelIntent } = useApp()
  const [events, setEvents] = useState<Event[]>(ctxEvents || [])
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([])
  const [travel, setTravel] = useState<TravelRow[]>([])
  const [travelAcks, setTravelAcks] = useState<TravelAckRow[]>([])
  const [bookingConfigs, setBookingConfigs] = useState<BookingRow[]>([])
  const [assetOrders, setAssetOrders] = useState<EventPromotionalAssetOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [assetEditorFor, setAssetEditorFor] = useState<Event | null>(null)

  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'

  // Refresh from DB so we pick up status / workers changes that happened
  // in the legacy view, and load the readiness signals.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      const todayIso = new Date().toISOString().slice(0, 10)
      const [eventsRes, campaignsRes, travelRes, travelAcksRes, bookingRes, assetsRes] = await Promise.all([
        supabase.from('events').select('*').order('start_date'),
        supabase.from('marketing_campaigns').select('event_id, flow_type, status, paid_at'),
        supabase.from('travel_reservations').select('event_id, buyer_id, type'),
        supabase.from('travel_acknowledgments').select('event_id, buyer_id, type'),
        supabase.from('booking_config').select('store_id, day1_start'),
        supabase.from('event_promotional_asset_orders').select('*'),
      ])
      if (cancelled) return
      if (eventsRes.data) setEvents(eventsRes.data.map((e: any) => ({ ...e, days: e.days || [] })))
      if (campaignsRes.data) setCampaigns(campaignsRes.data as CampaignRow[])
      if (travelRes.data) setTravel(travelRes.data as TravelRow[])
      if (travelAcksRes.data) setTravelAcks(travelAcksRes.data as TravelAckRow[])
      if (bookingRes.data) setBookingConfigs(bookingRes.data as BookingRow[])
      if (assetsRes.data) setAssetOrders(assetsRes.data as EventPromotionalAssetOrder[])
      void todayIso
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  const upcoming = useMemo(() => {
    const todayIso = new Date().toISOString().slice(0, 10)
    const q = search.trim().toLowerCase()
    return events
      .filter(e => e.status !== 'cancelled')
      .filter(e => !!e.start_date && eventEndIso(e.start_date) >= todayIso)
      .filter(e => {
        if (!q) return true
        const name = eventDisplayName(e, stores).toLowerCase()
        const store = stores.find(s => s.id === e.store_id)
        const cityState = `${store?.city || ''} ${store?.state || ''}`.toLowerCase()
        return name.includes(q) || cityState.includes(q)
      })
      .sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''))
  }, [events, search, stores])

  const campaignsByEvent = useMemo(() => {
    const m = new Map<string, CampaignRow[]>()
    for (const c of campaigns) {
      const arr = m.get(c.event_id) || []
      arr.push(c)
      m.set(c.event_id, arr)
    }
    return m
  }, [campaigns])

  const travelByEvent = useMemo(() => {
    const m = new Map<string, TravelRow[]>()
    for (const t of travel) {
      const arr = m.get(t.event_id) || []
      arr.push(t)
      m.set(t.event_id, arr)
    }
    return m
  }, [travel])

  const travelAcksByEvent = useMemo(() => {
    const m = new Map<string, TravelAckRow[]>()
    for (const a of travelAcks) {
      const arr = m.get(a.event_id) || []
      arr.push(a)
      m.set(a.event_id, arr)
    }
    return m
  }, [travelAcks])

  const liveBookingStores = useMemo(() => {
    const s = new Set<string>()
    for (const b of bookingConfigs) {
      if (b.day1_start) s.add(b.store_id)
    }
    return s
  }, [bookingConfigs])

  const assetOrdersByEvent = useMemo(() => {
    const m = new Map<string, EventPromotionalAssetOrder[]>()
    for (const o of assetOrders) {
      const arr = m.get(o.event_id) || []
      arr.push(o); m.set(o.event_id, arr)
    }
    return m
  }, [assetOrders])

  async function markBriefed(ev: Event, briefed: boolean) {
    const ok = briefed
      ? confirm(`Mark staff as briefed for "${eventDisplayName(ev, stores)}"?`)
      : confirm(`Un-mark staff as briefed for "${eventDisplayName(ev, stores)}"?`)
    if (!ok) return
    const update = briefed
      ? { staff_briefed_at: new Date().toISOString(), staff_briefed_by_user_id: user?.id || null }
      : { staff_briefed_at: null, staff_briefed_by_user_id: null }
    const { error } = await supabase.from('events').update(update).eq('id', ev.id)
    if (error) { alert(error.message); return }
    setEvents(es => es.map(e => e.id === ev.id ? { ...e, ...update } : e))
  }

  // Manual override for chips that lack a hard data prerequisite
  // (travel / marketing / assets). Set = force green; clear = drop
  // back to computed state.
  async function setOverride(
    ev: Event,
    kind: 'travel' | 'marketing' | 'assets',
    on: boolean,
  ) {
    const noun = kind === 'travel' ? 'travel' : kind === 'marketing' ? 'marketing' : 'in-store assets'
    const ok = on
      ? confirm(`Manually mark ${noun} as complete for "${eventDisplayName(ev, stores)}"?\n\nThis forces the chip green regardless of underlying data.`)
      : confirm(`Clear the manual ${noun} override for "${eventDisplayName(ev, stores)}"?\n\nThe chip will drop back to its computed status.`)
    if (!ok) return
    const atKey = `${kind}_override_at`
    const byKey = `${kind}_override_by_user_id`
    const update: Record<string, any> = on
      ? { [atKey]: new Date().toISOString(), [byKey]: user?.id || null }
      : { [atKey]: null, [byKey]: null }
    const { error } = await supabase.from('events').update(update).eq('id', ev.id)
    if (error) { alert(error.message); return }
    setEvents(es => es.map(e => e.id === ev.id ? { ...e, ...update } : e))
  }

  if (loading) {
    return <div style={{ padding: 24, color: 'var(--mist)', fontSize: 13 }}>Loading readiness…</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <SearchBox value={search} onChange={setSearch} placeholder="Search by store or city…" />

      {upcoming.length === 0 && (
        <div style={{
          background: '#fff', border: '1px solid var(--cream2)', borderRadius: 10,
          padding: 32, textAlign: 'center', color: 'var(--mist)', fontSize: 14,
        }}>
          {search.trim()
            ? <>No upcoming events match "<strong>{search}</strong>".</>
            : <>No upcoming buying events. Use Legacy view to schedule one.</>}
        </div>
      )}

      {upcoming.map(ev => (
        <EventReadinessCard
          key={ev.id}
          ev={ev}
          campaigns={campaignsByEvent.get(ev.id) || []}
          travel={travelByEvent.get(ev.id) || []}
          travelAcks={travelAcksByEvent.get(ev.id) || []}
          bookingLive={liveBookingStores.has(ev.store_id)}
          assetOrders={assetOrdersByEvent.get(ev.id) || []}
          allEvents={events}
          stores={stores}
          isAdmin={isAdmin}
          setNav={setNav}
          onOpenTravel={() => { setTravelIntent({ eventId: ev.id }); setNav?.('travel') }}
          onPromoted={(id) => setEvents(es => es.map(e => e.id === id ? { ...e, status: 'scheduled' } : e))}
          onAssetEdit={() => setAssetEditorFor(ev)}
          onMarkBriefed={(briefed) => markBriefed(ev, briefed)}
          onSetOverride={(kind, on) => setOverride(ev, kind, on)}
        />
      ))}

      {assetEditorFor && (
        <AssetOrderEditor
          ev={assetEditorFor}
          orders={assetOrdersByEvent.get(assetEditorFor.id) || []}
          userId={user?.id}
          onClose={() => setAssetEditorFor(null)}
          onChange={(next) => setAssetOrders(prev => {
            const others = prev.filter(o => o.event_id !== assetEditorFor.id)
            return [...others, ...next]
          })}
        />
      )}
    </div>
  )
}

// ── Per-event card ─────────────────────────────────────────────

interface CardProps {
  ev: Event
  campaigns: CampaignRow[]
  travel: TravelRow[]
  travelAcks: TravelAckRow[]
  bookingLive: boolean
  assetOrders: EventPromotionalAssetOrder[]
  allEvents: Event[]
  stores: ReturnType<typeof useApp>['stores']
  isAdmin: boolean
  setNav?: (n: NavPage) => void
  onOpenTravel: () => void
  onPromoted: (id: string) => void
  onAssetEdit: () => void
  onMarkBriefed: (briefed: boolean) => void
  onSetOverride: (kind: 'travel' | 'marketing' | 'assets', on: boolean) => void
}

function EventReadinessCard({
  ev, campaigns, travel, travelAcks, bookingLive, assetOrders, allEvents, stores,
  isAdmin, setNav, onOpenTravel, onPromoted, onAssetEdit, onMarkBriefed, onSetOverride,
}: CardProps) {
  const reserved = ev.status === 'reserved'
  const [buyerPopover, setBuyerPopover] = useState(false)

  // Buyers
  const workers = (ev.workers || []).filter(w => !(w as any).deleted)
  const buyersNeeded = ev.buyers_needed ?? null
  const buyerStatus: GateLevel =
    buyersNeeded == null ? 'neutral' :
    workers.length >= buyersNeeded ? 'green' :
    workers.length === 0 ? 'red' : 'yellow'
  const conflictCount = workers.reduce((sum, w) => {
    const conflicts = findOverlapping(w.id, ev, allEvents)
    return sum + (conflicts.length > 0 ? 1 : 0)
  }, 0)

  // Travel — a buyer counts as "covered" for flight or hotel if EITHER
  // they have a real reservation row OR they've marked an ack
  // ('self_X' = "I have one outside the system" / 'no_X' = "Don't
  // need"). Mirrors the chip logic in components/travel/Travel.tsx.
  const travelCoverage = workers.map(w => {
    const myRes = travel.filter(t => t.buyer_id === w.id)
    const myAcks = travelAcks.filter(a => a.buyer_id === w.id)
    const hasFlight =
      myRes.some(t => t.type === 'flight')
      || myAcks.some(a => a.type === 'self_flight' || a.type === 'no_flight')
    const hasHotel =
      myRes.some(t => t.type === 'hotel')
      || myAcks.some(a => a.type === 'self_hotel' || a.type === 'no_hotel')
    return { hasFlight, hasHotel }
  })
  const travelComplete = travelCoverage.filter(c => c.hasFlight && c.hasHotel).length
  const travelOverridden = !!ev.travel_override_at
  const travelStatus: GateLevel = travelOverridden ? 'green' :
    workers.length === 0 ? 'neutral' :
    travelComplete === workers.length ? 'green' :
    travelComplete === 0 ? 'red' : 'yellow'

  // Marketing — three flows. "done" or paid_at set = green for that flow.
  const flows: ('vdp' | 'postcard' | 'newspaper')[] = ['vdp', 'postcard', 'newspaper']
  const flowChips = flows.map(f => {
    const c = campaigns.find(c => c.flow_type === f)
    if (!c) return { flow: f, level: 'red' as GateLevel, label: 'Not started' }
    if (c.status === 'done' || c.paid_at) return { flow: f, level: 'green' as GateLevel, label: 'Done' }
    if (c.status === 'payment' || c.status === 'proofing') return { flow: f, level: 'yellow' as GateLevel, label: c.status }
    return { flow: f, level: 'red' as GateLevel, label: c.status }
  })
  const marketingOverridden = !!ev.marketing_override_at
  const marketingStatus: GateLevel = marketingOverridden ? 'green' :
    flowChips.every(c => c.level === 'green') ? 'green' :
    flowChips.some(c => c.level !== 'red') ? 'yellow' : 'red'

  // Booking — NOT overrideable per spec.
  const bookingStatus: GateLevel = bookingLive ? 'green' : 'red'

  // In-store assets — green if all orders delivered, yellow if any
  // ordered but not all delivered, red if no orders at all.
  const assetCount = assetOrders.length
  const deliveredCount = assetOrders.filter(o => o.delivered_at).length
  const assetsOverridden = !!ev.assets_override_at
  const assetStatus: GateLevel = assetsOverridden ? 'green' :
    assetCount === 0 ? 'red' :
    deliveredCount === assetCount ? 'green' : 'yellow'

  // Staff briefed — green if briefed, red otherwise.
  const briefed = !!ev.staff_briefed_at
  const briefedStatus: GateLevel = briefed ? 'green' : 'red'

  const store = stores.find(s => s.id === ev.store_id)
  const range = ev.start_date ? formatEventRange(ev.start_date) : ''
  const display = eventDisplayName(ev, stores)

  async function promote() {
    if (!confirm(`Promote "${display}" to Booked?\n\nThis flips the status to scheduled and triggers the normal notifications.`)) return
    const { error } = await supabase.from('events').update({ status: 'scheduled' }).eq('id', ev.id)
    if (error) { alert(error.message); return }
    onPromoted(ev.id)
  }

  return (
    <div style={{
      background: '#fff', border: `1px solid ${reserved ? '#d4a017' : 'var(--cream2)'}`,
      borderRadius: 10, padding: '14px 16px',
      borderLeft: `4px solid ${reserved ? '#d4a017' : 'var(--green-dark)'}`,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>
            {reserved && <span style={{
              display: 'inline-block', fontSize: 10, fontWeight: 800,
              background: '#fff4d6', color: '#8a6d00', padding: '2px 6px', borderRadius: 4,
              marginRight: 8, verticalAlign: 'middle',
            }}>📌 RESERVED</span>}
            {display}
          </div>
          <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 2 }}>
            {store?.city}{store?.state ? `, ${store.state}` : ''} · {range}
          </div>
        </div>
        {reserved && isAdmin && (
          <button onClick={promote} className="btn-primary btn-sm">✅ Promote to Booked</button>
        )}
      </div>

      {/* Gate chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <span style={{ position: 'relative' }}>
          <Chip
            level={buyerStatus}
            label={
              buyersNeeded == null
                ? `${workers.length} buyer${workers.length === 1 ? '' : 's'}`
                : `${workers.length}/${buyersNeeded} buyers${conflictCount > 0 ? ` · ${conflictCount} conflict${conflictCount === 1 ? '' : 's'}` : ''}`
            }
            icon="👥"
            onClick={() => setBuyerPopover(o => !o)}
            title="Click to see who's assigned"
          />
          {buyerPopover && (
            <BuyerPopover
              workers={workers}
              onClose={() => setBuyerPopover(false)}
              onManage={() => { setBuyerPopover(false); setNav?.('events') }}
            />
          )}
        </span>
        <OverridableChip
          level={travelStatus}
          label={
            travelOverridden ? 'Travel ✓ Override' :
            workers.length === 0 ? 'Travel — assign buyers first' :
            `Travel ${travelComplete}/${workers.length}`
          }
          icon="✈️"
          onClick={onOpenTravel}
          title="Open this event in Travel"
          overridden={travelOverridden}
          onOverride={() => onSetOverride('travel', true)}
          onClearOverride={() => onSetOverride('travel', false)}
        />
        <OverridableChip
          level={marketingStatus}
          label={
            marketingOverridden
              ? 'Marketing ✓ Override'
              : `Marketing: ${flowChips.map(f => `${f.flow.toUpperCase()[0]}=${f.level === 'green' ? '✓' : f.level === 'yellow' ? '~' : '○'}`).join(' ')}`
          }
          icon="📣"
          onClick={() => setNav?.('marketing')}
          title="Open Marketing module"
          overridden={marketingOverridden}
          onOverride={() => onSetOverride('marketing', true)}
          onClearOverride={() => onSetOverride('marketing', false)}
        />
        <Chip
          level={bookingStatus}
          label={bookingLive ? 'Booking system live' : 'Booking system not configured'}
          icon="📅"
          onClick={() => setNav?.('calendar')}
          title="Open Calendar / Appointments admin"
        />
        <OverridableChip
          level={assetStatus}
          label={
            assetsOverridden ? 'In-store assets ✓ Override' :
            assetCount === 0 ? 'In-store assets — none ordered' :
            `In-store assets ${deliveredCount}/${assetCount} delivered`
          }
          icon="📦"
          onClick={onAssetEdit}
          title="Manage counter cards / displays / postcards"
          overridden={assetsOverridden}
          onOverride={() => onSetOverride('assets', true)}
          onClearOverride={() => onSetOverride('assets', false)}
        />
        <Chip
          level={briefedStatus}
          label={briefed ? 'Staff briefed' : 'Staff not yet briefed'}
          icon="🎓"
          onClick={() => onMarkBriefed(!briefed)}
          title={briefed ? 'Click to un-mark briefed' : 'Click to mark staff briefed'}
        />
      </div>
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────

type GateLevel = 'green' | 'yellow' | 'red' | 'neutral'

// Lightweight popover anchored under the buyer chip — shows who's
// assigned (lead first) and offers a "Manage in Legacy" link.
// Closes on outside click + Esc.
function BuyerPopover({
  workers, onClose, onManage,
}: {
  workers: { id: string; name: string }[]
  onClose: () => void
  onManage: () => void
}) {
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const el = e.target as HTMLElement
      if (!el.closest('[data-buyer-popover]')) onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      data-buyer-popover
      style={{
        position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 50,
        background: '#fff', border: '1px solid var(--cream2)', borderRadius: 8,
        boxShadow: '0 6px 20px rgba(0,0,0,.10)',
        padding: 8, minWidth: 200, maxWidth: 280,
      }}
    >
      {workers.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--mist)', padding: '6px 8px' }}>
          No buyers assigned yet.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {workers.map((w, i) => (
            <li key={w.id} style={{
              fontSize: 13, padding: '4px 8px', borderRadius: 4,
              color: 'var(--ink)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            }}>
              <span>{w.name}</span>
              {i === 0 && (
                <span style={{
                  fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 3,
                  background: 'var(--cream2)', color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.04em',
                }}>Lead</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <div style={{
        borderTop: '1px solid var(--cream2)', marginTop: 6, paddingTop: 6,
        textAlign: 'right',
      }}>
        <button
          onClick={onManage}
          style={{
            background: 'transparent', border: 'none',
            color: 'var(--green-dark)', fontSize: 11, fontWeight: 700,
            cursor: 'pointer', padding: '2px 4px',
          }}
        >Manage in Legacy →</button>
      </div>
    </div>
  )
}

// Wraps a Chip with a tiny inline action — "Override" when red,
// "↺" undo when overridden. Chip itself keeps its existing onClick
// (deep-link); the override controls live alongside as separate
// buttons so the deep-link still works.
function OverridableChip({
  level, label, icon, onClick, title,
  overridden, onOverride, onClearOverride,
}: {
  level: GateLevel; label: string; icon: string; onClick?: () => void; title?: string
  overridden: boolean
  onOverride: () => void
  onClearOverride: () => void
}) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <Chip level={level} label={label} icon={icon} onClick={onClick} title={title} />
      {overridden ? (
        <button
          onClick={onClearOverride}
          title="Clear manual override"
          style={overrideMiniBtn('var(--green-dark)')}
        >↺</button>
      ) : level === 'red' ? (
        <button
          onClick={onOverride}
          title="Manually mark complete (force green)"
          style={overrideMiniBtn('var(--ash)')}
        >✓ Override</button>
      ) : null}
    </span>
  )
}

function overrideMiniBtn(color: string): React.CSSProperties {
  return {
    fontFamily: 'inherit', fontSize: 10, fontWeight: 700,
    padding: '3px 7px', borderRadius: 6, cursor: 'pointer',
    background: '#fff', color, border: `1px dashed ${color}`,
    lineHeight: 1.2, whiteSpace: 'nowrap',
  }
}

function Chip({
  level, label, icon, onClick, title,
}: { level: GateLevel; label: string; icon: string; onClick?: () => void; title?: string }) {
  const colors: Record<GateLevel, { bg: string; fg: string; bd: string }> = {
    green:   { bg: '#e8f5e9', fg: '#1b5e20', bd: '#a5d6a7' },
    yellow:  { bg: '#fff8e1', fg: '#7a5b00', bd: '#ffd54f' },
    red:     { bg: '#fdecea', fg: '#7a1f0f', bd: '#ef9a9a' },
    neutral: { bg: 'var(--cream2)', fg: 'var(--mist)', bd: 'var(--cream2)' },
  }
  const c = colors[level]
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
        padding: '5px 10px', borderRadius: 6,
        background: c.bg, color: c.fg, border: `1px solid ${c.bd}`,
        cursor: onClick ? 'pointer' : 'default',
        display: 'inline-flex', alignItems: 'center', gap: 5,
      }}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  )
}

function AssetOrderEditor({
  ev, orders, userId, onClose, onChange,
}: {
  ev: Event
  orders: EventPromotionalAssetOrder[]
  userId?: string
  onClose: () => void
  onChange: (next: EventPromotionalAssetOrder[]) => void
}) {
  const [working, setWorking] = useState<string | null>(null)
  const [draftType, setDraftType] = useState('counter_card')
  const [draftDescription, setDraftDescription] = useState('')
  const [draftQuantity, setDraftQuantity] = useState('')
  const [draftVendor, setDraftVendor] = useState('')

  async function addOrder() {
    if (!draftType.trim()) { alert('Asset type is required'); return }
    setWorking('add')
    const { data, error } = await supabase
      .from('event_promotional_asset_orders')
      .insert({
        event_id: ev.id,
        asset_type: draftType.trim(),
        description: draftDescription.trim() || null,
        quantity: draftQuantity.trim() ? Number(draftQuantity) : null,
        vendor: draftVendor.trim() || null,
        ordered_at: new Date().toISOString(),
        created_by_user_id: userId || null,
      })
      .select()
      .maybeSingle()
    setWorking(null)
    if (error || !data) { alert('Failed to add: ' + (error?.message || 'unknown')); return }
    onChange([...orders, data as EventPromotionalAssetOrder])
    setDraftType('counter_card'); setDraftDescription(''); setDraftQuantity(''); setDraftVendor('')
  }

  async function patchOrder(id: string, patch: Partial<EventPromotionalAssetOrder>) {
    setWorking(id)
    const { data, error } = await supabase
      .from('event_promotional_asset_orders')
      .update(patch).eq('id', id).select().maybeSingle()
    setWorking(null)
    if (error || !data) { alert('Failed: ' + (error?.message || 'unknown')); return }
    onChange(orders.map(o => o.id === id ? (data as EventPromotionalAssetOrder) : o))
  }

  async function deleteOrder(id: string) {
    if (!confirm('Delete this order?')) return
    setWorking(id)
    const { error } = await supabase.from('event_promotional_asset_orders').delete().eq('id', id)
    setWorking(null)
    if (error) { alert('Failed: ' + error.message); return }
    onChange(orders.filter(o => o.id !== id))
  }

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '40px 16px', overflowY: 'auto',
      }}>
      <div style={{
        background: '#fff', borderRadius: 10, maxWidth: 640, width: '100%',
        padding: '18px 20px', boxShadow: 'var(--shadow-lg)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontWeight: 800, color: 'var(--ink)' }}>📦 In-store assets</div>
          <button onClick={onClose} className="btn-outline btn-xs">Close</button>
        </div>

        {orders.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--mist)', padding: '10px 0', textAlign: 'center' }}>
            No orders yet. Add one below.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
            {orders.map(o => (
              <div key={o.id} style={{
                border: '1px solid var(--cream2)', borderRadius: 8, padding: '8px 10px',
                background: o.delivered_at ? '#ecfdf5' : (o.shipped_at ? '#fff8e1' : 'var(--cream2)'),
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
                    {o.asset_type}
                    {o.quantity ? <span style={{ color: 'var(--mist)', fontWeight: 500 }}> × {o.quantity}</span> : null}
                  </div>
                  <button onClick={() => deleteOrder(o.id)} disabled={working === o.id}
                    style={{ background: 'transparent', border: 'none', color: 'var(--mist)', cursor: 'pointer', fontSize: 14 }}>✕</button>
                </div>
                {(o.description || o.vendor) && (
                  <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 2 }}>
                    {o.description}{o.description && o.vendor ? ' · ' : ''}{o.vendor}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6, marginTop: 8, fontSize: 11 }}>
                  <Stage label="Ordered" at={o.ordered_at} />
                  <Stage label="Shipped" at={o.shipped_at} />
                  <Stage label="Delivered" at={o.delivered_at} />
                  <div style={{ flex: 1 }} />
                  {!o.shipped_at && (
                    <button onClick={() => patchOrder(o.id, { shipped_at: new Date().toISOString() })}
                      disabled={working === o.id} className="btn-outline btn-xs">Mark Shipped</button>
                  )}
                  {!o.delivered_at && (
                    <button onClick={() => patchOrder(o.id, { delivered_at: new Date().toISOString(), shipped_at: o.shipped_at || new Date().toISOString() })}
                      disabled={working === o.id} className="btn-primary btn-xs">Mark Delivered</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{
          padding: 10, border: '1px dashed var(--pearl)', borderRadius: 8,
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
        }}>
          <label style={{ fontSize: 11, color: 'var(--mist)', fontWeight: 700 }}>
            Type
            <input value={draftType} onChange={e => setDraftType(e.target.value)} placeholder="counter_card"
              style={{ width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid var(--cream2)', borderRadius: 6, fontFamily: 'inherit', marginTop: 2 }} />
          </label>
          <label style={{ fontSize: 11, color: 'var(--mist)', fontWeight: 700 }}>
            Quantity
            <input value={draftQuantity} onChange={e => setDraftQuantity(e.target.value)} type="number" min="1"
              style={{ width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid var(--cream2)', borderRadius: 6, fontFamily: 'inherit', marginTop: 2 }} />
          </label>
          <label style={{ fontSize: 11, color: 'var(--mist)', fontWeight: 700, gridColumn: 'span 2' }}>
            Description
            <input value={draftDescription} onChange={e => setDraftDescription(e.target.value)} placeholder="Holiday counter card design"
              style={{ width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid var(--cream2)', borderRadius: 6, fontFamily: 'inherit', marginTop: 2 }} />
          </label>
          <label style={{ fontSize: 11, color: 'var(--mist)', fontWeight: 700 }}>
            Vendor
            <input value={draftVendor} onChange={e => setDraftVendor(e.target.value)}
              style={{ width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid var(--cream2)', borderRadius: 6, fontFamily: 'inherit', marginTop: 2 }} />
          </label>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button onClick={addOrder} disabled={working === 'add'} className="btn-primary btn-sm" style={{ width: '100%' }}>
              {working === 'add' ? 'Adding…' : '+ Add order'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Stage({ label, at }: { label: string; at: string | null }) {
  const done = !!at
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
      background: done ? '#dcfce7' : 'var(--cream2)',
      color: done ? '#065f46' : 'var(--mist)',
    }}>
      {done ? '✓' : '○'} {label}
    </span>
  )
}

function SearchBox({
  value, onChange, placeholder,
}: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div style={{ position: 'relative' }}>
      <span style={{
        position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
        color: 'var(--mist)', fontSize: 13, pointerEvents: 'none',
      }}>🔍</span>
      <input
        type="search"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%', boxSizing: 'border-box',
          padding: '8px 32px 8px 32px',
          fontSize: 13, fontFamily: 'inherit',
          background: '#fff', color: 'var(--ink)',
          border: '1px solid var(--cream2)', borderRadius: 8,
        }}
      />
      {value && (
        <button
          onClick={() => onChange('')}
          aria-label="Clear search"
          style={{
            position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--mist)', fontSize: 14, padding: 4, lineHeight: 1,
          }}
        >✕</button>
      )}
    </div>
  )
}

// Local copy of the conflict math from Events.tsx — keep them in sync.
function findOverlapping(buyerId: string, currentEv: Event, allEvents: Event[]): Event[] {
  const days = eventDayKeys(currentEv)
  if (days.length === 0) return []
  return allEvents.filter(other => {
    if (other.id === currentEv.id) return false
    if (!(other.workers || []).some(w => w.id === buyerId)) return false
    const otherDays = eventDayKeys(other)
    return days.some(d => otherDays.includes(d))
  })
}

function eventDayKeys(ev: { start_date?: string | null }): string[] {
  if (!ev.start_date) return []
  return [0, 1, 2].map(i => {
    const d = new Date(ev.start_date + 'T12:00:00')
    d.setDate(d.getDate() + i)
    return d.toISOString().slice(0, 10)
  })
}
