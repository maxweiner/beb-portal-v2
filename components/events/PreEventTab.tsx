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
import CancelEventModal from './CancelEventModal'
import { CALENDAR_COLORS } from '@/lib/calendarColors'

export type CampaignRow = {
  event_id: string
  flow_type: 'vdp' | 'postcard' | 'newspaper'
  status: 'setup' | 'planning' | 'proofing' | 'payment' | 'done'
  paid_at: string | null
}

export type TravelRow = {
  event_id: string
  buyer_id: string
  type: 'flight' | 'hotel' | 'rental_car'
}

export type TravelAckRow = {
  event_id: string
  buyer_id: string
  type: string  // 'self_flight' | 'self_hotel' | 'no_flight' | 'no_hotel' | 'no_rental_car'
}

type BookingRow = { store_id: string; day1_start: string | null }

export type LastEventNote = {
  id: string
  category: 'worked' | 'didnt_work' | 'do_differently'
  content: string
  user_name: string
  created_at: string
}
export type LastEventLesson = {
  /** The trunk show / buying event we pulled notes from. */
  pastEventId: string
  pastEventStartDate: string
  notes: LastEventNote[]
}

interface Props {
  setNav?: (n: NavPage) => void
  /** When true, each event row collapses to a single line (store name +
   *  dates) and expands to the full readiness card on click. Accordion
   *  behavior — only one row open at a time. */
  slim?: boolean
}

export default function PreEventTab({ setNav, slim = false }: Props) {
  const { stores, events: ctxEvents, user, brand, setTravelIntent, users } = useApp()
  // Accordion state for slim mode. Null when nothing is open.
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [events, setEvents] = useState<Event[]>(ctxEvents || [])
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([])
  const [travel, setTravel] = useState<TravelRow[]>([])
  const [travelAcks, setTravelAcks] = useState<TravelAckRow[]>([])
  const [bookingConfigs, setBookingConfigs] = useState<BookingRow[]>([])
  const [assetOrders, setAssetOrders] = useState<EventPromotionalAssetOrder[]>([])
  // Map: store_id → most-recent past event at that store + its notes.
  const [lastLessonsByStore, setLastLessonsByStore] = useState<Map<string, LastEventLesson>>(new Map())
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [assetEditorFor, setAssetEditorFor] = useState<Event | null>(null)
  const [cancelEventId, setCancelEventId] = useState<string | null>(null)

  // isAdmin in this file gates non-destructive surfaces (Promote, edit
  // buyers, etc). Partners + admins/superadmins all qualify here.
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin' || user?.is_partner === true
  // Cancel + delete-forever are partner/superadmin-only — narrower than
  // isAdmin so plain admins can't trigger destructive ops. Mirrors the
  // server gate in /api/events/[id]/cancel.
  const canCancel = user?.role === 'superadmin' || user?.is_partner === true

  // Refresh from DB so we pick up status / workers changes that happened
  // in the legacy view, and load the readiness signals.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      const todayIso = new Date().toISOString().slice(0, 10)
      const [eventsRes, campaignsRes, travelRes, travelAcksRes, bookingRes, assetsRes] = await Promise.all([
        // Brand-scoped — AppContext.events is loaded with this same
        // filter; mirror it here so we don't pull the other brand's
        // events into this tab.
        supabase.from('events').select('*').eq('brand', brand).order('start_date'),
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

      // Last-event lessons: for every store with an upcoming event,
      // find the most recent past event at the same store and pull
      // its event_notes. Two batched queries keep this O(1) regardless
      // of how many cards are visible.
      const upcomingStoreIds = Array.from(new Set(
        (eventsRes.data || [])
          .filter((e: any) => e.status !== 'cancelled' && e.start_date && eventEndIso(e.start_date) >= todayIso)
          .map((e: any) => e.store_id)
      ))
      if (upcomingStoreIds.length > 0) {
        const { data: pastEvs } = await supabase
          .from('events')
          .select('id, store_id, start_date')
          .eq('brand', brand)
          .in('store_id', upcomingStoreIds)
          .lt('start_date', todayIso)
          .order('start_date', { ascending: false })
        if (cancelled) return
        // Take the first (most recent) per store_id.
        const latestByStore = new Map<string, { id: string; start_date: string }>()
        for (const ev of (pastEvs || [])) {
          if (!latestByStore.has(ev.store_id)) {
            latestByStore.set(ev.store_id, { id: ev.id, start_date: ev.start_date })
          }
        }
        const pastEventIds = Array.from(latestByStore.values()).map(v => v.id)
        if (pastEventIds.length > 0) {
          const { data: notes } = await supabase
            .from('event_notes')
            .select('id, event_id, category, content, user_name, created_at')
            .in('event_id', pastEventIds)
            .order('created_at', { ascending: false })
          if (cancelled) return
          const notesByEventId = new Map<string, LastEventNote[]>()
          for (const n of (notes || [])) {
            const arr = notesByEventId.get(n.event_id) || []
            arr.push({ id: n.id, category: n.category, content: n.content, user_name: n.user_name, created_at: n.created_at })
            notesByEventId.set(n.event_id, arr)
          }
          const lessonMap = new Map<string, LastEventLesson>()
          for (const [storeId, ev] of latestByStore.entries()) {
            const evNotes = notesByEventId.get(ev.id) || []
            if (evNotes.length > 0) {
              lessonMap.set(storeId, {
                pastEventId: ev.id,
                pastEventStartDate: ev.start_date,
                notes: evNotes,
              })
            }
          }
          setLastLessonsByStore(lessonMap)
        }
      }

      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [brand])

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
          slim={slim}
          expanded={slim ? expandedId === ev.id : true}
          onToggleExpand={slim ? () => setExpandedId(cur => cur === ev.id ? null : ev.id) : undefined}
          campaigns={campaignsByEvent.get(ev.id) || []}
          travel={travelByEvent.get(ev.id) || []}
          travelAcks={travelAcksByEvent.get(ev.id) || []}
          bookingLive={liveBookingStores.has(ev.store_id)}
          assetOrders={assetOrdersByEvent.get(ev.id) || []}
          lastLesson={lastLessonsByStore.get(ev.store_id) || null}
          allEvents={events}
          stores={stores}
          isAdmin={isAdmin}
          canCancel={canCancel}
          currentUserId={user?.id}
          currentUserName={user?.name || null}
          setNav={setNav}
          onOpenTravel={() => { setTravelIntent({ eventId: ev.id }); setNav?.('travel') }}
          onPromoted={(id) => setEvents(es => es.map(e => e.id === id ? { ...e, status: 'scheduled' } : e))}
          onAssetEdit={() => setAssetEditorFor(ev)}
          onMarkBriefed={(briefed) => markBriefed(ev, briefed)}
          onSetOverride={(kind, on) => setOverride(ev, kind, on)}
          onCarriedForward={(noteId) => {
            // Drop the carried note from the panel so the user
            // doesn't accidentally double-carry it.
            setLastLessonsByStore(prev => {
              const next = new Map(prev)
              const cur = next.get(ev.store_id)
              if (!cur) return prev
              next.set(ev.store_id, { ...cur, notes: cur.notes.filter(n => n.id !== noteId) })
              return next
            })
          }}
          onCancelClick={() => setCancelEventId(ev.id)}
          allUsers={users}
          onWorkersChange={(workers) => {
            setEvents(prev => prev.map(e => e.id === ev.id ? { ...e, workers } as Event : e))
          }}
        />
      ))}

      {cancelEventId && (
        <CancelEventModal
          eventId={cancelEventId}
          onClose={() => setCancelEventId(null)}
          onCancelled={() => {
            // Drop the cancelled event from this tab's local list so the
            // card disappears immediately. The PreEventTab filter
            // already excludes status='cancelled' rows, but the local
            // state hasn't been refetched yet.
            setEvents(prev => prev.filter(e => e.id !== cancelEventId))
          }}
        />
      )}

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

export interface CardProps {
  ev: Event
  campaigns: CampaignRow[]
  travel: TravelRow[]
  travelAcks: TravelAckRow[]
  bookingLive: boolean
  assetOrders: EventPromotionalAssetOrder[]
  lastLesson: LastEventLesson | null
  allEvents: Event[]
  stores: ReturnType<typeof useApp>['stores']
  isAdmin: boolean
  /** Narrower than isAdmin: only superadmin + partners. Drives the
   *  Cancel button's visibility so plain admins don't see it. */
  canCancel: boolean
  currentUserId: string | undefined
  currentUserName: string | null
  setNav?: (n: NavPage) => void
  onOpenTravel: () => void
  onPromoted: (id: string) => void
  onAssetEdit: () => void
  onMarkBriefed: (briefed: boolean) => void
  onSetOverride: (kind: 'travel' | 'marketing' | 'assets', on: boolean) => void
  onCarriedForward: (noteId: string) => void
  onCancelClick: () => void
  allUsers: ReturnType<typeof useApp>['users']
  onWorkersChange: (workers: { id: string; name: string }[]) => void
  /** When true, render the slim collapsed-row layout. Expanded state is
   *  controlled by the parent for accordion behavior. */
  slim?: boolean
  expanded?: boolean
  onToggleExpand?: () => void
}

export function EventReadinessCard({
  ev, campaigns, travel, travelAcks, bookingLive, assetOrders, lastLesson, allEvents, stores,
  isAdmin, canCancel, currentUserId, currentUserName, setNav, onOpenTravel, onPromoted, onAssetEdit, onMarkBriefed, onSetOverride, onCarriedForward, onCancelClick,
  allUsers, onWorkersChange,
  slim = false, expanded = true, onToggleExpand,
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

  // Slim collapsed: a single bigger row with store name + dates.
  // Slim expanded: same row at the top + the full body below.
  // Non-slim: existing header layout (title + actions in one flex row).
  const cardOuterStyle: React.CSSProperties = {
    background: '#fff',
    border: `1px solid ${reserved ? CALENDAR_COLORS.buying.main : 'var(--cream2)'}`,
    borderRadius: 10,
    padding: slim ? (expanded ? '12px 16px 14px' : '12px 16px') : '14px 16px',
    borderLeftStyle: reserved ? 'dashed' : 'solid',
    borderLeftWidth: 4,
    borderLeftColor: CALENDAR_COLORS.buying.main,
  }
  if (slim && !expanded) {
    return (
      <div style={cardOuterStyle}>
        <SlimHeader display={display} range={range} reserved={reserved} expanded={false} onClick={onToggleExpand} />
      </div>
    )
  }

  return (
    <div style={cardOuterStyle}>
      {slim ? (
        <SlimHeader display={display} range={range} reserved={reserved} expanded={true} onClick={onToggleExpand} />
      ) : (
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>
              {reserved && <span style={{
                display: 'inline-block', fontSize: 10, fontWeight: 800,
                background: CALENDAR_COLORS.buying.light, color: CALENDAR_COLORS.buying.text,
                padding: '2px 6px', borderRadius: 4,
                marginRight: 8, verticalAlign: 'middle',
              }}>📌 RESERVED</span>}
              {display}
            </div>
            <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 2 }}>
              {store?.city}{store?.state ? `, ${store.state}` : ''} · {range}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {reserved && isAdmin && (
              <button onClick={promote} className="btn-primary btn-sm">✅ Promote to Booked</button>
            )}
            {canCancel && (
              <button
                onClick={onCancelClick}
                className="btn-outline btn-sm"
                style={{ color: '#B22234', borderColor: '#fecdd3' }}
                title="Cancel this event (paused campaigns, optional appointment + buyer notifications)"
              >
                🚫 Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {/* In slim+expanded mode the action buttons + city/state row live
          inside the body since the slim header reserves its layout for
          the bigger title + dates. */}
      {slim && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 10, flexWrap: 'wrap', margin: '10px 0 12px',
        }}>
          <div style={{ fontSize: 12, color: 'var(--mist)' }}>
            {store?.city}{store?.state ? `, ${store.state}` : ''}
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
            {reserved && isAdmin && (
              <button onClick={promote} className="btn-primary btn-sm">✅ Promote to Booked</button>
            )}
            {canCancel && (
              <button
                onClick={onCancelClick}
                className="btn-outline btn-sm"
                style={{ color: '#B22234', borderColor: '#fecdd3' }}
                title="Cancel this event (paused campaigns, optional appointment + buyer notifications)"
              >
                🚫 Cancel
              </button>
            )}
          </div>
        </div>
      )}

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
              eventId={ev.id}
              workers={workers}
              allUsers={allUsers}
              isAdmin={isAdmin}
              onClose={() => setBuyerPopover(false)}
              onChange={onWorkersChange}
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
          onClick={() => setNav?.('appointments')}
          title="Open Appointments admin"
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

      {lastLesson && lastLesson.notes.length > 0 && (
        <LastEventLessons
          lesson={lastLesson}
          newEventId={ev.id}
          newEventStoreId={ev.store_id}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          onCarried={onCarriedForward}
        />
      )}
    </div>
  )
}

// Past notes panel + carry-forward action. Collapsed by default
// to keep the card compact.
function LastEventLessons({
  lesson, newEventId, newEventStoreId, currentUserId, currentUserName, onCarried,
}: {
  lesson: LastEventLesson
  newEventId: string
  newEventStoreId: string
  currentUserId: string | undefined
  currentUserName: string | null
  onCarried: (noteId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function carryForward(note: LastEventNote) {
    setBusyId(note.id)
    const { error } = await supabase.from('event_notes').insert({
      event_id: newEventId,
      store_id: newEventStoreId,
      user_id:   currentUserId || null,
      user_name: currentUserName || 'Carried over',
      category:  note.category,
      content:   `(carried from ${formatPastDate(lesson.pastEventStartDate)}) ${note.content}`,
    })
    setBusyId(null)
    if (error) { alert(error.message); return }
    onCarried(note.id)
  }

  const totals = lesson.notes.reduce((acc, n) => {
    acc[n.category] = (acc[n.category] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--cream2)', borderRadius: 8 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 12 }}>
          <span style={{ fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
            📝 Lessons from last event ({formatPastDate(lesson.pastEventStartDate)})
          </span>
          <span style={{ color: 'var(--mist)' }}>
            <strong style={{ color: '#065f46' }}>{totals.worked || 0}</strong> 👍 ·{' '}
            <strong style={{ color: '#7a1f0f' }}>{totals.didnt_work || 0}</strong> 👎 ·{' '}
            <strong style={{ color: '#7a5b00' }}>{totals.do_differently || 0}</strong> 🔄 {open ? '▾' : '▸'}
          </span>
        </div>
      </button>

      {open && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(['do_differently', 'didnt_work', 'worked'] as const).map(cat => {
            const items = lesson.notes.filter(n => n.category === cat)
            if (items.length === 0) return null
            return (
              <div key={cat}>
                <div style={{ fontSize: 10, fontWeight: 800, color: catColor(cat).fg, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>
                  {catEmoji(cat)} {catLabel(cat)}
                </div>
                {items.map(n => (
                  <div key={n.id} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 8,
                    padding: '6px 8px', borderRadius: 6,
                    background: '#fff', border: `1px solid ${catColor(cat).bd}`,
                    marginBottom: 4,
                  }}>
                    <div style={{ flex: 1, fontSize: 12, color: 'var(--ink)', lineHeight: 1.4 }}>
                      {n.content}
                      <div style={{ fontSize: 10, color: 'var(--mist)', marginTop: 2 }}>— {n.user_name}</div>
                    </div>
                    <button
                      onClick={() => carryForward(n)}
                      disabled={busyId === n.id}
                      title="Carry this note forward to the upcoming event"
                      style={{
                        fontSize: 10, fontWeight: 700,
                        padding: '4px 7px', borderRadius: 4, cursor: 'pointer',
                        background: '#fff', color: catColor(cat).fg,
                        border: `1px solid ${catColor(cat).fg}`, whiteSpace: 'nowrap', flexShrink: 0,
                      }}
                    >
                      {busyId === n.id ? '…' : '↪ Carry forward'}
                    </button>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function catLabel(c: 'worked' | 'didnt_work' | 'do_differently'): string {
  return c === 'worked' ? 'Worked' : c === 'didnt_work' ? "Didn't work" : 'Do differently next time'
}
function catEmoji(c: 'worked' | 'didnt_work' | 'do_differently'): string {
  return c === 'worked' ? '👍' : c === 'didnt_work' ? '👎' : '🔄'
}
function catColor(c: 'worked' | 'didnt_work' | 'do_differently'): { fg: string; bd: string } {
  if (c === 'worked')        return { fg: '#065f46', bd: '#a5d6a7' }
  if (c === 'didnt_work')    return { fg: '#7a1f0f', bd: '#ef9a9a' }
  return { fg: '#7a5b00', bd: '#ffd54f' }
}
function formatPastDate(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Helpers ────────────────────────────────────────────────────

type GateLevel = 'green' | 'yellow' | 'red' | 'neutral'

// Lightweight popover anchored under the buyer chip — shows who's
// assigned (lead first) and offers a "Manage in Legacy" link.
// Closes on outside click + Esc.
export function BuyerPopover({
  eventId, workers, allUsers, isAdmin, onClose, onChange,
  presentation = 'popover',
}: {
  eventId: string
  workers: { id: string; name: string }[]
  allUsers: ReturnType<typeof useApp>['users']
  isAdmin: boolean
  onClose: () => void
  onChange: (workers: { id: string; name: string }[]) => void
  /** 'popover' = absolute-positioned, anchored to a relative parent (legacy
   *  behavior for the chip in PreEventTab). 'panel' = flat layout suitable
   *  for embedding inside a modal dialog (used by HubView). */
  presentation?: 'popover' | 'panel'
}) {
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    // Click-outside-to-close only matters for the popover anchored inside a
    // page. The 'panel' variant lives inside a modal which manages its own
    // dismissal via backdrop + Escape.
    if (presentation !== 'popover') return
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
  }, [onClose, presentation])

  // PUT through the chokepoint so the buyer_added_to_event /
  // buyer_removed notifications fire as they do in legacy.
  async function persist(next: { id: string; name: string }[]) {
    setBusy(true)
    try {
      const res = await fetch(`/api/events/${eventId}/workers`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workers: next }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert('Failed to update buyers: ' + (j.error || res.statusText))
        return
      }
      onChange(next)
    } finally {
      setBusy(false)
    }
  }

  function add(u: { id: string; name?: string | null }) {
    if (workers.some(w => w.id === u.id)) return
    persist([...workers, { id: u.id, name: u.name || '' }])
  }
  function remove(uid: string) {
    persist(workers.filter(w => w.id !== uid))
  }
  function makeLead(uid: string) {
    const target = workers.find(w => w.id === uid)
    if (!target) return
    persist([target, ...workers.filter(w => w.id !== uid)])
  }

  // Eligible adds: active users explicitly flagged is_buyer (Admin
  // Panel → user row → Buyer toggle). Treats undefined as TRUE to
  // match the legacy convention (`is_buyer !== false`) — older user
  // rows that never had the flag set still surface here. Sort by
  // name alphabetically.
  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase()
    const assignedIds = new Set(workers.map(w => w.id))
    return (allUsers || [])
      .filter((u: any) => u.active !== false && u.is_buyer !== false && !assignedIds.has(u.id))
      .filter((u: any) => !q || `${u.name} ${u.email}`.toLowerCase().includes(q))
      .sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''))
  }, [allUsers, workers, search])

  return (
    <div
      data-buyer-popover
      style={presentation === 'popover' ? {
        position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 50,
        background: '#fff', border: '1px solid var(--cream2)', borderRadius: 8,
        boxShadow: '0 6px 20px rgba(0,0,0,.10)',
        padding: 10, minWidth: 280, maxWidth: 340,
      } : {
        background: '#fff', borderRadius: 8, padding: 0,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>
        Assigned ({workers.length})
      </div>
      {workers.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--mist)', padding: '6px 4px', fontStyle: 'italic' }}>
          No buyers yet — add one below.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 10 }}>
          {workers.map((w, i) => {
            const isLead = i === 0
            return (
              <li key={w.id} style={{
                fontSize: 13, padding: '4px 8px', borderRadius: 4,
                background: isLead ? 'var(--green-pale)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
              }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--ink)' }}>
                  {w.name}
                  {isLead && (
                    <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 3, background: 'var(--green-dark)', color: '#fff', textTransform: 'uppercase', letterSpacing: '.04em' }}>Lead</span>
                  )}
                </span>
                {isAdmin && (
                  <span style={{ display: 'inline-flex', gap: 4 }}>
                    {!isLead && (
                      <button onClick={() => makeLead(w.id)} disabled={busy} title="Make lead"
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--mist)', padding: '0 4px' }}>⭐</button>
                    )}
                    <button onClick={() => remove(w.id)} disabled={busy} title="Remove"
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--mist)', padding: '0 4px' }}>×</button>
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {isAdmin && (
        <>
          <div style={{ borderTop: '1px solid var(--cream2)', paddingTop: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>
              Add a buyer
            </div>
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name…"
              style={{ width: '100%', fontSize: 13, marginBottom: 6 }}
            />
            <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--cream2)', borderRadius: 4 }}>
              {candidates.length === 0 ? (
                <div style={{ padding: 8, fontSize: 12, color: 'var(--mist)', fontStyle: 'italic' }}>
                  {search ? 'No matches.' : 'Everyone\'s already assigned.'}
                </div>
              ) : candidates.map((u: any) => (
                <button
                  key={u.id}
                  onClick={() => add(u)}
                  disabled={busy}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '6px 10px', border: 'none', background: 'transparent',
                    cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
                    borderBottom: '1px solid var(--cream2)',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--cream)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  + {u.name || u.email}
                  {u.role && (
                    <span style={{ fontSize: 10, color: 'var(--mist)', marginLeft: 6 }}>· {u.role}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
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

/**
 * Slim header — single-line clickable row used by the Slim view.
 * Bigger fonts (store name 18px / 800, dates 14px) and a chevron
 * affordance signal expand/collapse on click. The store name takes
 * the lead since it's how staff actually identify an event.
 */
function SlimHeader({
  display, range, reserved, expanded, onClick,
}: {
  display: string
  range: string
  reserved: boolean
  expanded: boolean
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', width: '100%', alignItems: 'center',
        justifyContent: 'space-between', gap: 12,
        background: 'transparent', border: 'none', padding: 0, margin: 0,
        cursor: onClick ? 'pointer' : 'default', fontFamily: 'inherit',
        textAlign: 'left',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 18, fontWeight: 800, color: 'var(--ink)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {reserved && <span style={{
            display: 'inline-block', fontSize: 9, fontWeight: 800,
            background: CALENDAR_COLORS.buying.light, color: CALENDAR_COLORS.buying.text,
            padding: '1px 5px', borderRadius: 3, marginRight: 8,
            verticalAlign: 'middle', letterSpacing: '.04em',
          }}>📌 RESERVED</span>}
          {display}
        </div>
        <div style={{
          fontSize: 14, fontWeight: 700, color: 'var(--mist)',
          whiteSpace: 'nowrap',
        }}>
          {range}
        </div>
      </div>
      <span style={{
        fontSize: 11, color: 'var(--mist)', flexShrink: 0,
        display: 'inline-block', transition: 'transform .15s ease',
        transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
      }}>▶</span>
    </button>
  )
}

function eventDayKeys(ev: { start_date?: string | null }): string[] {
  if (!ev.start_date) return []
  return [0, 1, 2].map(i => {
    const d = new Date(ev.start_date + 'T12:00:00')
    d.setDate(d.getDate() + i)
    return d.toISOString().slice(0, 10)
  })
}
