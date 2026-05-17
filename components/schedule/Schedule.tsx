'use client'

// Calendar (Schedule) page — the orchestrator. Owns the data fetches
// (trade shows / trunk shows / shipments / vacations), the per-user
// toggles (Vacations / Buying Events / Trade Shows / Trunk Shows +
// trunk-rep filter), the view switcher, and the side drawers. Each
// view + drawer + shared util now lives in its own sibling file —
// see types.ts and helpers.ts for the contracts.

import { useState, useEffect, useMemo } from 'react'
import { useApp } from '@/lib/context'
import type { Event, BuyerVacation } from '@/types'
import type { NavPage } from '@/app/page'
import { supabase } from '@/lib/supabase'
import { CALENDAR_COLORS } from '@/lib/calendarColors'

import type { ShipmentEntry, TradeShowOverlay, TrunkShowOverlay, ViewMode } from './types'
import { useIsNarrow } from './helpers'
import MonthView from './MonthView'
import WeekView from './WeekView'
import DayView from './DayView'
import TimelineView from './TimelineView'
import AgendaView from './AgendaView'
import KanbanView from './KanbanView'
import DetailModal from './DetailModal'
import ShipmentDrawer from './ShipmentDrawer'

const VIEW_KEY = 'beb-calendar-view'

export default function Schedule({ setNav }: { setNav?: (n: NavPage) => void } = {}) {
  const { events, stores, users, user, brand, setTradeShowIntent, setTrunkShowIntent } = useApp()
  const [view, setView] = useState<ViewMode>('month')
  const [shipments, setShipments] = useState<ShipmentEntry[]>([])
  const [shipmentDetail, setShipmentDetail] = useState<ShipmentEntry | null>(null)
  // Trade shows overlay — admins / sales reps see them on the
  // month grid alongside buying events. Trunk shows are NOT
  // overlaid (per the e1 walled-off rule). Toggle persisted to
  // localStorage so a user's preference sticks across sessions.
  const [tradeShows, setTradeShows] = useState<TradeShowOverlay[]>([])
  const [showTradeShows, setShowTradeShows] = useState(() => {
    if (typeof window === 'undefined') return true
    return localStorage.getItem('beb-show-trade-shows') !== 'false'
  })
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('beb-show-trade-shows', String(showTradeShows))
    }
  }, [showTradeShows])
  useEffect(() => {
    let cancelled = false
    supabase.from('trade_shows')
      .select('id, name, start_date, end_date, venue_city, venue_state')
      .is('deleted_at', null)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) { setTradeShows([]); return }  // RLS may block — degrade silently
        setTradeShows((data || []) as TradeShowOverlay[])
      })
    return () => { cancelled = true }
  }, [])

  // Trunk shows overlay — same pattern as trade shows. Pulls in the
  // store name + city/state from trunk_show_stores so the day-cell
  // chip is meaningful at a glance.
  const [trunkShows, setTrunkShows] = useState<TrunkShowOverlay[]>([])
  const [trunkRepFilter, setTrunkRepFilter] = useState<string>('all')
  const [showTrunkShows, setShowTrunkShows] = useState(() => {
    if (typeof window === 'undefined') return true
    return localStorage.getItem('beb-show-trunk-shows') !== 'false'
  })
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('beb-show-trunk-shows', String(showTrunkShows))
    }
  }, [showTrunkShows])
  useEffect(() => {
    let cancelled = false
    supabase.from('trunk_shows')
      .select('id, start_date, end_date, assigned_rep_id, store:trunk_show_stores(name, city, state)')
      .is('deleted_at', null)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) { setTrunkShows([]); return }   // RLS may block — degrade silently
        const rows: TrunkShowOverlay[] = (data || []).map((r: any) => ({
          id: r.id,
          start_date: r.start_date,
          end_date: r.end_date,
          assigned_rep_id: r.assigned_rep_id ?? null,
          store_name: r.store?.name || 'Trunk Show',
          city: r.store?.city ?? null,
          state: r.store?.state ?? null,
        }))
        setTrunkShows(rows)
      })
    return () => { cancelled = true }
  }, [])

  // Buying events toggle — events are the calendar's primary content,
  // but giving a hide control lets the user focus on Selling overlays
  // when they want to see only trade/trunk activity.
  const [showEvents, setShowEvents] = useState(() => {
    if (typeof window === 'undefined') return true
    return localStorage.getItem('beb-show-buying-events') !== 'false'
  })
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('beb-show-buying-events', String(showEvents))
    }
  }, [showEvents])
  // Cancelled events drop off the calendar entirely. The cancel
  // flow (PR #402) flips status='cancelled'; without this filter the
  // chip still rendered alongside live events.
  const displayedEvents = showEvents
    ? events.filter(e => (e as any).status !== 'cancelled')
    : []

  // Brand-scoped shipments. Re-fetches on brand switch.
  useEffect(() => {
    let cancelled = false
    supabase.from('event_shipments')
      .select('id, event_id, store_id, ship_date, jewelry_box_count, silver_box_count, status, events!inner(brand, store_name, workers, start_date)')
      .eq('events.brand', brand)
      .neq('status', 'cancelled')
      .then(({ data }) => {
        if (cancelled) return
        const rows = (data || []).map((r: any) => ({
          id: r.id,
          event_id: r.event_id,
          store_id: r.store_id,
          store_name: r.events?.store_name || '',
          ship_date: r.ship_date,
          jewelry_box_count: r.jewelry_box_count,
          silver_box_count: r.silver_box_count,
          status: r.status,
          event_workers: r.events?.workers || [],
          event_start_date: r.events?.start_date || '',
        })) as ShipmentEntry[]
        setShipments(rows)
      })
    return () => { cancelled = true }
  }, [brand])
  // Restore last-used view per user.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const saved = window.localStorage.getItem(VIEW_KEY) as ViewMode | null
    if (saved && ['month','week','day','timeline','agenda','kanban'].includes(saved)) {
      setView(saved)
    }
  }, [])
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(VIEW_KEY, view)
  }, [view])
  const [detail, setDetail] = useState<Event | null>(null)

  // Trunk-rep dropdown options — every distinct rep referenced by a
  // trunk show, sorted by name. Falls back to the user id when the
  // user record isn't in context (e.g. ex-rep). useMemo keeps the
  // list stable across re-renders so the <select> doesn't churn.
  const trunkRepOptions = useMemo(() => {
    const ids = Array.from(new Set(
      trunkShows.map(t => t.assigned_rep_id).filter((x): x is string => !!x),
    ))
    return ids
      .map(id => ({
        id,
        name: users.find((u: any) => u.id === id)?.name || id.slice(0, 8),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [trunkShows, users])

  // Click on a buying-event chip → navigate to Buying Events and
  // dispatch a focus intent the destination page listens for to
  // scroll/highlight the matching card. Replaces the old behaviour
  // of opening a tiny detail modal.
  const openBuyingEvent = (ev: Event) => {
    if (!setNav) { setDetail(ev); return }
    setNav('buying-events')
    setTimeout(() => window.dispatchEvent(
      new CustomEvent('beb:focus-event', { detail: { eventId: ev.id } }),
    ), 0)
  }
  const [vacations, setVacations] = useState<BuyerVacation[]>([])
  const [showVacations, setShowVacations] = useState(() => {
    if (typeof window === 'undefined') return true
    return localStorage.getItem('beb-show-vacations') !== 'false'
  })
  const isNarrow = useIsNarrow()

  useEffect(() => {
    supabase.from('buyer_vacations').select('*').then(({ data }) => setVacations(data || []))
  }, [])

  const toggleShowVacations = () => {
    const next = !showVacations
    setShowVacations(next)
    localStorage.setItem('beb-show-vacations', String(next))
  }

  const views: { id: ViewMode; label: string }[] = [
    { id: 'month',    label: '▦  Month'    },
    { id: 'week',     label: '▤  Week'     },
    { id: 'day',      label: '▏ Day'       },
    { id: 'timeline', label: '▬  Timeline' },
    { id: 'agenda',   label: '☰  Agenda'   },
    { id: 'kanban',   label: '⊞  Kanban'   },
  ]

  return (
    <div style={{ padding: isNarrow ? 14 : 24 }}>
      <div style={{
        display: 'flex',
        flexDirection: isNarrow ? 'column' : 'row',
        alignItems: isNarrow ? 'stretch' : 'center',
        justifyContent: 'space-between',
        marginBottom: isNarrow ? 14 : 20,
        flexWrap: 'wrap', gap: isNarrow ? 10 : 12,
      }}>
        <div>
          <h1 style={{ fontSize: isNarrow ? 18 : 22, fontWeight: 900, color: 'var(--ink)', margin: 0 }}>Calendar</h1>
          <div style={{ fontSize: 13, color: 'var(--mist)', marginTop: 2 }}>Visual planning view · {events.length} events</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={toggleShowVacations} style={{
            padding: isNarrow ? '10px 14px' : '7px 12px', borderRadius: 'var(--r)',
            border: '1px solid var(--pearl)', cursor: 'pointer',
            fontSize: 13, fontWeight: 700,
            background: showVacations ? 'var(--cream2)' : 'transparent',
            color: showVacations ? 'var(--ash)' : 'var(--fog)',
            minHeight: isNarrow ? 44 : undefined,
          }}>
            ☀ Vacations {showVacations ? 'ON' : 'OFF'}
          </button>
          <button onClick={() => setShowEvents(s => !s)} style={{
            padding: isNarrow ? '10px 14px' : '7px 12px', borderRadius: 'var(--r)',
            border: '1px solid var(--pearl)', cursor: 'pointer',
            fontSize: 13, fontWeight: 700,
            background: showEvents ? CALENDAR_COLORS.buying.light : 'transparent',
            color: showEvents ? CALENDAR_COLORS.buying.text : 'var(--fog)',
            minHeight: isNarrow ? 44 : undefined,
          }}>
            ◆ Buying Events {showEvents ? 'ON' : 'OFF'}
          </button>
          {tradeShows.length > 0 && (
            <button onClick={() => setShowTradeShows(s => !s)} style={{
              padding: isNarrow ? '10px 14px' : '7px 12px', borderRadius: 'var(--r)',
              border: '1px solid var(--pearl)', cursor: 'pointer',
              fontSize: 13, fontWeight: 700,
              background: showTradeShows ? CALENDAR_COLORS.trade.light : 'transparent',
              color: showTradeShows ? CALENDAR_COLORS.trade.text : 'var(--fog)',
              minHeight: isNarrow ? 44 : undefined,
            }}>
              🎪 Trade Shows {showTradeShows ? 'ON' : 'OFF'}
            </button>
          )}
          {trunkShows.length > 0 && (
            <button onClick={() => setShowTrunkShows(s => !s)} style={{
              padding: isNarrow ? '10px 14px' : '7px 12px', borderRadius: 'var(--r)',
              border: '1px solid var(--pearl)', cursor: 'pointer',
              fontSize: 13, fontWeight: 700,
              background: showTrunkShows ? CALENDAR_COLORS.trunk.light : 'transparent',
              color: showTrunkShows ? CALENDAR_COLORS.trunk.text : 'var(--fog)',
              minHeight: isNarrow ? 44 : undefined,
            }}>
              💼 Trunk Shows {showTrunkShows ? 'ON' : 'OFF'}
            </button>
          )}
          {/* Trunk-rep filter — narrows the trunk-show overlay to a
              single rep's schedule. Only meaningful when trunk shows
              are toggled on AND there's more than one rep across the
              loaded shows. */}
          {showTrunkShows && trunkShows.length > 0 && trunkRepOptions.length > 1 && (
            <select
              value={trunkRepFilter}
              onChange={e => setTrunkRepFilter(e.target.value)}
              style={{
                padding: isNarrow ? '10px 12px' : '7px 10px',
                borderRadius: 'var(--r)', border: '1px solid var(--pearl)',
                fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
                background: '#fff', color: 'var(--ash)',
                minHeight: isNarrow ? 44 : undefined,
                width: 'auto',
              }}
              title="Filter trunk shows to one rep"
            >
              <option value="all">👥 All trunk reps</option>
              {trunkRepOptions.map(opt => (
                <option key={opt.id} value={opt.id}>{opt.name}</option>
              ))}
            </select>
          )}
          <div style={{
            display: isNarrow ? 'grid' : 'flex',
            gridTemplateColumns: isNarrow ? 'repeat(4, 1fr)' : undefined,
            gap: 4, background: 'var(--cream2)', padding: 4,
            borderRadius: 'var(--r)', border: '1px solid var(--pearl)',
            flex: isNarrow ? '1 1 auto' : undefined,
          }}>
            {views.map(v => (
              <button key={v.id} onClick={() => setView(v.id)} style={{
                padding: isNarrow ? '10px 6px' : '7px 16px',
                borderRadius: 'calc(var(--r) - 2px)', border: 'none', cursor: 'pointer',
                fontSize: isNarrow ? 12 : 13, fontWeight: 700, transition: 'all .15s',
                background: view === v.id ? 'var(--sidebar-bg)' : 'transparent',
                color: view === v.id ? '#fff' : 'var(--ash)',
                minHeight: isNarrow ? 44 : undefined,
              }}>{v.label}</button>
            ))}
          </div>
        </div>
      </div>

      {(() => {
        // Apply the trunk-rep filter on top of the show/hide toggle.
        // 'all' = every trunk show; otherwise only the rep's shows.
        const baseTrunks = showTrunkShows ? trunkShows : []
        const visibleTrunks = trunkRepFilter === 'all'
          ? baseTrunks
          : baseTrunks.filter(t => t.assigned_rep_id === trunkRepFilter)
        const openTrunk = (id: string) => { setTrunkShowIntent({ trunkShowId: id }); setNav?.('trunk-shows') }
        return (
          <>
            {view === 'month'    && <MonthView    events={displayedEvents} stores={stores} users={users} vacations={showVacations ? vacations : []} currentUserId={user?.id} onSelect={openBuyingEvent} isNarrow={isNarrow} shipments={shipments} onSelectShipment={setShipmentDetail} tradeShows={showTradeShows ? tradeShows : []} trunkShows={visibleTrunks} onOpenTradeShow={(id) => { setTradeShowIntent({ tradeShowId: id }); setNav?.('trade-shows') }} onOpenTrunkShow={openTrunk} />}
            {view === 'week'     && <WeekView     events={displayedEvents} stores={stores} onSelect={openBuyingEvent} isNarrow={isNarrow} />}
            {view === 'day'      && <DayView      events={displayedEvents} stores={stores} onSelect={openBuyingEvent} isNarrow={isNarrow} />}
            {view === 'timeline' && <TimelineView events={displayedEvents} stores={stores} onSelect={openBuyingEvent} isNarrow={isNarrow} onSwitchView={setView} trunkShows={visibleTrunks} users={users} onOpenTrunkShow={openTrunk} />}
            {view === 'agenda'   && <AgendaView   events={displayedEvents} stores={stores} onSelect={openBuyingEvent} isNarrow={isNarrow} trunkShows={visibleTrunks} users={users} onOpenTrunkShow={openTrunk} />}
            {view === 'kanban'   && <KanbanView   events={displayedEvents} stores={stores} onSelect={openBuyingEvent} isNarrow={isNarrow} trunkShows={visibleTrunks} users={users} onOpenTrunkShow={openTrunk} />}
          </>
        )
      })()}

      {detail && <DetailModal ev={detail} stores={stores} onClose={() => setDetail(null)} isNarrow={isNarrow} />}
      {shipmentDetail && (
        <ShipmentDrawer
          shipment={shipmentDetail}
          onClose={() => setShipmentDetail(null)}
        />
      )}
    </div>
  )
}
