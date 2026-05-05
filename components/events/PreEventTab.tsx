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
import type { Event } from '@/types'
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

type BookingRow = { store_id: string; day1_start: string | null }

interface Props {
  setNav?: (n: NavPage) => void
}

export default function PreEventTab({ setNav }: Props) {
  const { stores, events: ctxEvents, user } = useApp()
  const [events, setEvents] = useState<Event[]>(ctxEvents || [])
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([])
  const [travel, setTravel] = useState<TravelRow[]>([])
  const [bookingConfigs, setBookingConfigs] = useState<BookingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'

  // Refresh from DB so we pick up status / workers changes that happened
  // in the legacy view, and load the readiness signals.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      const todayIso = new Date().toISOString().slice(0, 10)
      const [eventsRes, campaignsRes, travelRes, bookingRes] = await Promise.all([
        supabase.from('events').select('*').order('start_date'),
        supabase.from('marketing_campaigns').select('event_id, flow_type, status, paid_at'),
        supabase.from('travel_reservations').select('event_id, buyer_id, type'),
        supabase.from('booking_config').select('store_id, day1_start'),
      ])
      if (cancelled) return
      if (eventsRes.data) setEvents(eventsRes.data.map((e: any) => ({ ...e, days: e.days || [] })))
      if (campaignsRes.data) setCampaigns(campaignsRes.data as CampaignRow[])
      if (travelRes.data) setTravel(travelRes.data as TravelRow[])
      if (bookingRes.data) setBookingConfigs(bookingRes.data as BookingRow[])
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

  const liveBookingStores = useMemo(() => {
    const s = new Set<string>()
    for (const b of bookingConfigs) {
      if (b.day1_start) s.add(b.store_id)
    }
    return s
  }, [bookingConfigs])

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
          bookingLive={liveBookingStores.has(ev.store_id)}
          allEvents={events}
          stores={stores}
          isAdmin={isAdmin}
          setNav={setNav}
          onPromoted={(id) => setEvents(es => es.map(e => e.id === id ? { ...e, status: 'scheduled' } : e))}
        />
      ))}
    </div>
  )
}

// ── Per-event card ─────────────────────────────────────────────

interface CardProps {
  ev: Event
  campaigns: CampaignRow[]
  travel: TravelRow[]
  bookingLive: boolean
  allEvents: Event[]
  stores: ReturnType<typeof useApp>['stores']
  isAdmin: boolean
  setNav?: (n: NavPage) => void
  onPromoted: (id: string) => void
}

function EventReadinessCard({
  ev, campaigns, travel, bookingLive, allEvents, stores,
  isAdmin, setNav, onPromoted,
}: CardProps) {
  const reserved = ev.status === 'reserved'

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

  // Travel
  const travelCoverage = workers.map(w => {
    const mine = travel.filter(t => t.buyer_id === w.id)
    return { hasFlight: mine.some(t => t.type === 'flight'), hasHotel: mine.some(t => t.type === 'hotel') }
  })
  const travelComplete = travelCoverage.filter(c => c.hasFlight && c.hasHotel).length
  const travelStatus: GateLevel =
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
  const marketingStatus: GateLevel =
    flowChips.every(c => c.level === 'green') ? 'green' :
    flowChips.some(c => c.level !== 'red') ? 'yellow' : 'red'

  // Booking
  const bookingStatus: GateLevel = bookingLive ? 'green' : 'red'

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
        <Chip
          level={buyerStatus}
          label={
            buyersNeeded == null
              ? `${workers.length} buyer${workers.length === 1 ? '' : 's'}`
              : `${workers.length}/${buyersNeeded} buyers${conflictCount > 0 ? ` · ${conflictCount} conflict${conflictCount === 1 ? '' : 's'}` : ''}`
          }
          icon="👥"
          onClick={() => setNav?.('events')}
          title="Open in Legacy view to assign buyers"
        />
        <Chip
          level={travelStatus}
          label={
            workers.length === 0
              ? 'Travel — assign buyers first'
              : `Travel ${travelComplete}/${workers.length}`
          }
          icon="✈️"
          onClick={() => setNav?.('travel')}
          title="Open Travel module"
        />
        <Chip
          level={marketingStatus}
          label={`Marketing: ${flowChips.map(f => `${f.flow.toUpperCase()[0]}=${f.level === 'green' ? '✓' : f.level === 'yellow' ? '~' : '○'}`).join(' ')}`}
          icon="📣"
          onClick={() => setNav?.('marketing')}
          title="Open Marketing module"
        />
        <Chip
          level={bookingStatus}
          label={bookingLive ? 'Booking system live' : 'Booking system not configured'}
          icon="📅"
          onClick={() => setNav?.('calendar')}
          title="Open Calendar / Appointments admin"
        />
      </div>
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────

type GateLevel = 'green' | 'yellow' | 'red' | 'neutral'

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
