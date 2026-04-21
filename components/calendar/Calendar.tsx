'use client'

import { useState, useEffect, useRef } from 'react'
import { useApp } from '@/lib/context'
import type { Store, Event, Appointment } from '@/types'
import {
  STATE_TZ, dateInTz, hmInTz, timeInTz,
  parseIcal, detectSource, SOURCE_COLORS,
  generateSlots, formatSlotTime, getEventDayDate,
  friendlyDate, parseApptDetail
} from '@/lib/calendar'

interface CalendarState {
  appointments: Record<string, Appointment[]> // storeId -> appts
  loading: Record<string, boolean>
  lastRefresh: Date | null
}

export default function Calendar() {
  const { events, stores, user } = useApp()
  const [calState, setCalState] = useState<CalendarState>({
    appointments: {},
    loading: {},
    lastRefresh: null,
  })
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [selectedDay, setSelectedDay] = useState(1)
  const [calFilter, setCalFilter] = useState<'active'|'all'|'days30'|'days60'|'past'>('active')
  const storesRef = useRef(stores)
  storesRef.current = stores

  // Viewport detection — the mobile path skips the event-cards picker when
  // the user is currently assigned to an active event.
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Find the user's currently-active event (today falls within its 3-day range).
  const myActiveEventId = (() => {
    if (!user) return null
    const today = new Date(); today.setHours(0, 0, 0, 0)
    for (const ev of events) {
      if (!ev.start_date) continue
      if (!(ev.workers || []).some((w: any) => w.id === user.id)) continue
      const start = new Date(ev.start_date + 'T12:00:00')
      const end   = new Date(ev.start_date + 'T12:00:00'); end.setDate(end.getDate() + 2); end.setHours(23, 59, 59)
      if (today >= start && today <= end) return ev.id
    }
    return null
  })()

  // Auto-select the active event on mobile, once.
  const autoOpenedRef = useRef(false)
  useEffect(() => {
    if (!isMobile || autoOpenedRef.current) return
    if (myActiveEventId && !selectedEventId) {
      autoOpenedRef.current = true
      setSelectedEventId(myActiveEventId)
    }
  }, [isMobile, myActiveEventId, selectedEventId])

  // Get all events with dates
  const allDatedEvents = events.filter(ev => !!ev.start_date)

  // Apply calendar filter
  const activeEvents = allDatedEvents.filter(ev => {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const start = new Date(ev.start_date + 'T12:00:00')
    const end = new Date(ev.start_date + 'T12:00:00'); end.setDate(end.getDate() + 2); end.setHours(23,59,59)
    const isPast = end < today
    const isFut = start > today
    const isCur = today >= start && today <= end
    if (calFilter === 'active') return isCur || isFut
    if (calFilter === 'past') return isPast
    if (calFilter === 'days30') { const d = new Date(today); d.setDate(d.getDate() + 30); return start <= d && end >= today }
    if (calFilter === 'days60') { const d = new Date(today); d.setDate(d.getDate() + 60); return start <= d && end >= today }
    return true
  })

  const fetchForStore = async (store: Store) => {
    if (!store.calendar_feed_url) return
    setCalState(prev => ({ ...prev, loading: { ...prev.loading, [store.id]: true } }))
    try {
      const res = await fetch(`/api/fetch-ical?url=${encodeURIComponent(store.calendar_feed_url)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      const rawAppts = parseIcal(text)
      const latest = storesRef.current.find(s => s.id === store.id) || store
      const offsetMs = (latest.calendar_offset_hours || 0) * 60 * 60 * 1000
      const appts = offsetMs === 0
        ? rawAppts
        : rawAppts.map(a => ({
            ...a,
            start: new Date(a.start.getTime() + offsetMs),
            end: new Date(a.end.getTime() + offsetMs),
          }))
      setCalState(prev => ({
        ...prev,
        appointments: { ...prev.appointments, [store.id]: appts },
        lastRefresh: new Date(),
        loading: { ...prev.loading, [store.id]: false },
      }))
    } catch (e: any) {
      console.error('Calendar fetch error:', e)
      setCalState(prev => ({ ...prev, loading: { ...prev.loading, [store.id]: false } }))
    }
  }

  const hasFetched = useRef(false)

  // Fetch once when stores are available, then every 5 min
  useEffect(() => {
    if (stores.length === 0) return
    if (hasFetched.current) {
      console.log('[Calendar] useEffect fired again but hasFetched=true, skipping. stores.length=', stores.length)
      return
    }
    hasFetched.current = true
    console.log('[Calendar] Initial fetch starting, stores.length=', stores.length)

    const doRefresh = () => {
      const storeIds = new Set(events.filter(ev => {
        if (!ev.start_date) return false
        const today = new Date(); today.setHours(0,0,0,0)
        const start = new Date(ev.start_date + 'T12:00:00')
        const end = new Date(ev.start_date + 'T12:00:00'); end.setDate(end.getDate() + 2)
        const twoWeeks = 14 * 24 * 60 * 60 * 1000
        return (end.getTime() - today.getTime()) >= -twoWeeks && (start.getTime() - today.getTime()) <= twoWeeks
      }).map(ev => ev.store_id))
      const activeStores = stores.filter(s => storeIds.has(s.id) && s.calendar_feed_url)
      activeStores.forEach(s => fetchForStore(s))
    }

    doRefresh()
    const timer = setInterval(doRefresh, 5 * 60 * 1000)
    return () => clearInterval(timer)
  }, [stores.length]) // eslint-disable-line

  const refreshAll = () => {
    const storeIds = new Set(activeEvents.map(ev => ev.store_id))
    stores.filter(s => storeIds.has(s.id) && s.calendar_feed_url).forEach(s => fetchForStore(s))
  }
  const openEvent = (ev: Event) => {
    const store = stores.find(s => s.id === ev.store_id)
    const tz = STATE_TZ[(store?.state || '').toUpperCase()] || 'America/New_York'
    const todayInTz = dateInTz(new Date(), tz)
    let defaultDay = 1
    for (let d = 1; d <= 3; d++) {
      if (getEventDayDate(ev.start_date, d) === todayInTz) { defaultDay = d; break }
    }
    setSelectedEventId(ev.id)
    setSelectedDay(defaultDay)
  }

  const selectedEvent = events.find(e => e.id === selectedEventId)

  // My events — used by the mobile drawer to switch between events.
  const myEvents = user
    ? events.filter(ev => (ev.workers || []).some((w: any) => w.id === user.id))
    : []

  if (isMobile && selectedEvent) {
    return (
      <MobileActiveAppointmentsView
        ev={selectedEvent}
        stores={stores}
        myEvents={myEvents}
        appointments={calState.appointments}
        loading={calState.loading}
        onPickEvent={(id) => setSelectedEventId(id)}
        onBack={() => setSelectedEventId(null)}
        onRefresh={() => {
          const store = stores.find(s => s.id === selectedEvent.store_id)
          if (store) fetchForStore(store)
        }}
      />
    )
  }

  return (
    <div style={{ padding: isMobile ? 12 : 24 }}>
      {selectedEvent ? (
        <DayView
          ev={selectedEvent}
          stores={stores}
          appointments={calState.appointments}
          loading={calState.loading}
          selectedDay={selectedDay}
          setSelectedDay={setSelectedDay}
          onBack={() => setSelectedEventId(null)}
          onRefresh={() => {
            const store = stores.find(s => s.id === selectedEvent.store_id)
            if (store) fetchForStore(store)
          }}
        />
      ) : (
        <EventCards
          activeEvents={activeEvents}
          calFilter={calFilter}
          setCalFilter={setCalFilter}
          stores={stores}
          appointments={calState.appointments}
          loading={calState.loading}
          lastRefresh={calState.lastRefresh}
          onOpen={openEvent}
          onRefreshAll={refreshAll}
        />
      )}
    </div>
  )
}

/* ── EVENT CARDS VIEW ── */
function EventCards({ activeEvents, stores, appointments, loading, lastRefresh, onOpen, onRefreshAll, calFilter, setCalFilter }: {
  activeEvents: Event[]
  calFilter: string
  setCalFilter: (f: any) => void
  stores: Store[]
  appointments: Record<string, Appointment[]>
  loading: Record<string, boolean>
  lastRefresh: Date | null
  onOpen: (ev: Event) => void
  onRefreshAll: () => void
}) {
  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-black" style={{ color: 'var(--ink)' }}>Calendar</h1>
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <span className="text-xs" style={{ color: 'var(--mist)' }}>
              Updated {lastRefresh.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
          <select value={calFilter} onChange={e => setCalFilter(e.target.value)} style={{ width: 'auto', fontSize: 13, padding: '6px 12px' }}>
            <option value="active">Current & Upcoming</option>
            <option value="all">All Events</option>
            <option value="days30">Next 30 Days</option>
            <option value="days60">Next 60 Days</option>
            <option value="past">Past</option>
          </select>
          <button onClick={onRefreshAll}
            className="btn-outline btn-sm"
            >
            ⟳ Refresh All
          </button>
        </div>
      </div>

      {activeEvents.length === 0 && (
        <div className="text-center py-20" style={{ color: 'var(--mist)' }}>
          <div className="text-5xl mb-4">📅</div>
          <div className="font-bold text-lg">No active events</div>
          <div className="text-sm mt-1">Events within the past/next 2 weeks will appear here</div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
        {activeEvents.map(ev => {
          const store = stores.find(s => s.id === ev.store_id)
          const tz = STATE_TZ[(store?.state || '').toUpperCase()] || 'America/New_York'
          const tzLabel = tz.replace('America/', '').replace(/_/g, ' ')
          const appts = appointments[store?.id || ''] || []
          const isLoading = loading[store?.id || '']
          const today = dateInTz(new Date(), tz)

          const dayCounts = [1, 2, 3].map(d => {
            const ds = getEventDayDate(ev.start_date, d)
            return appts.filter(a => dateInTz(a.start, tz) === ds).length
          })
          const total = dayCounts.reduce((a, b) => a + b, 0)
          const pct = Math.min(Math.round(total / 63 * 100), 100) // 63 = 3 days × 21 slots

          const evEnd = new Date(ev.start_date + 'T12:00:00')
          evEnd.setDate(evEnd.getDate() + 2); evEnd.setHours(23,59,59)
          const evStart = new Date(ev.start_date + 'T12:00:00')
          const todayDate = new Date(); todayDate.setHours(0,0,0,0)
          const stale = (todayDate.getTime() - evEnd.getTime()) > 7 * 24 * 60 * 60 * 1000
          const cur = todayDate >= evStart && todayDate <= evEnd
          const upcoming = !cur && !stale && evStart > todayDate

          return (
            <div key={ev.id}
              className="rounded-xl p-5 cursor-pointer transition-all hover:shadow-md"
              style={{
                background: 'var(--card-bg)',
                border: cur ? '1px solid var(--green)' : upcoming ? '1px solid var(--green)' : '1px solid var(--pearl)',
                borderLeft: cur ? '4px solid var(--green)' : upcoming ? '4px solid var(--green)' : stale ? '4px solid var(--pearl)' : '1px solid var(--pearl)',
                boxShadow: cur ? '0 0 0 2px var(--green-pale)' : 'none',
                opacity: stale ? 0.55 : 1,
                transition: 'opacity .2s',
              }}
              onClick={() => onOpen(ev)}>

              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="font-black text-base" style={{ color: 'var(--ink)' }}>◆ {store?.name || ev.store_name}</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--mist)' }}>
                    {store?.city}, {store?.state} · {ev.start_date} · ⏰ {tzLabel}
                  </div>
                </div>
                {isLoading ? (
                  <div className="text-xs" style={{ color: 'var(--mist)' }}>Loading…</div>
                ) : store?.calendar_feed_url ? (
                  <div className="text-right">
                    <div className="text-2xl font-black" style={{ color: 'var(--green)' }}>{total}</div>
                    <div className="text-xs" style={{ color: 'var(--mist)' }}>appts</div>
                  </div>
                ) : (
                  <span className="text-xs badge badge-gold">No feed</span>
                )}
              </div>

              {/* Progress bar */}
              {store?.calendar_feed_url && !isLoading && (
                <div className="mb-3">
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--cream2)' }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--green)' }} />
                  </div>
                </div>
              )}

              {/* Day pills */}
              <div className="flex gap-2">
                {[1, 2, 3].map((d, i) => {
                  const ds = getEventDayDate(ev.start_date, d)
                  const isToday = ds === today
                  return (
                    <div key={d} className="flex-1 rounded-lg p-2 text-center text-xs"
                      style={{
                        background: isToday ? 'var(--green-pale)' : 'var(--cream2)',
                        border: isToday ? '1px solid var(--green3)' : '1px solid transparent',
                        color: isToday ? 'var(--green-dark)' : 'var(--mist)',
                      }}>
                      <div className="font-bold">Day {d}</div>
                      <div className="font-black text-lg" style={{ color: isToday ? 'var(--green)' : 'var(--ash)' }}>
                        {store?.calendar_feed_url ? dayCounts[i] : '—'}
                      </div>
                    </div>
                  )
                })}
              </div>

              {!store?.calendar_feed_url && (
                <div className="mt-3 text-xs notice notice-gold">
                  Add a Google Calendar feed URL in Store Details to see appointments
                </div>
              )}

              <div className="mt-3 text-xs text-right font-bold" style={{ color: 'var(--green)' }}>
                View Calendar →
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

/* ── DAY VIEW ── */
function DayView({ ev, stores, appointments, loading, selectedDay, setSelectedDay, onBack, onRefresh }: {
  ev: Event
  stores: Store[]
  appointments: Record<string, Appointment[]>
  loading: Record<string, boolean>
  selectedDay: number
  setSelectedDay: (d: number) => void
  onBack: () => void
  onRefresh: () => void
}) {
  const store = stores.find(s => s.id === ev.store_id)
  const tz = STATE_TZ[(store?.state || '').toUpperCase()] || 'America/New_York'
  const tzLabel = tz.replace('America/', '').replace(/_/g, ' ')
  const isLoading = loading[store?.id || '']
  const allAppts = appointments[store?.id || ''] || []

  const dateStr = getEventDayDate(ev.start_date, selectedDay)
  const dayAppts = allAppts.filter(a => dateInTz(a.start, tz) === dateStr)
  const slots = generateSlots()

  const [detail, setDetail] = useState<Appointment | null>(null)
  const [detailPos, setDetailPos] = useState({ x: 0, y: 0 })

  const getApptForSlot = (slot: { h: number; m: number }) => {
    return dayAppts.find(a => {
      const { h, m } = hmInTz(a.start, tz)
      return Math.abs((h * 60 + m) - (slot.h * 60 + slot.m)) < 20
    })
  }

  const showDetail = (e: React.MouseEvent, appt: Appointment) => {
    e.stopPropagation()
    setDetail(appt)
    const x = Math.min(e.clientX + 12, window.innerWidth - 320)
    const y = Math.min(e.clientY - 10, window.innerHeight - 350)
    setDetailPos({ x, y })
  }

  // Dropdown options
  const dropdownOptions = [1, 2, 3].map(d => {
    const ds = getEventDayDate(ev.start_date, d)
    const cnt = allAppts.filter(a => dateInTz(a.start, tz) === ds).length
    return { d, ds, cnt }
  })

  return (
    <div onClick={() => setDetail(null)}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <button onClick={onBack}
          className="btn-outline btn-sm"
          >
          ← All Events
        </button>
        <div className="flex-1 min-w-0">
          <div className="font-black text-lg" style={{ color: 'var(--ink)' }}>◆ {store?.name || ev.store_name}</div>
          <div className="text-xs" style={{ color: 'var(--mist)' }}>
            {store?.city}, {store?.state} · ⏰ {tzLabel} time
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isLoading && <span className="text-xs" style={{ color: 'var(--mist)' }}>Refreshing…</span>}
          <button onClick={onRefresh}
            className="btn-outline btn-sm"
            >
            ⟳ Refresh
          </button>
        </div>
      </div>

      {/* Day dropdown */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <select
          value={selectedDay}
          onChange={e => setSelectedDay(Number(e.target.value))}
          style={{ minWidth: 260 }}>
          {dropdownOptions.map(({ d, ds, cnt }) => (
            <option key={d} value={d}>
              Day {d} — {friendlyDate(ds)} ({cnt} appointments)
            </option>
          ))}
        </select>
        <div className="text-sm" style={{ color: 'var(--mist)' }}>
          {dayAppts.length} booked · {slots.length - dayAppts.length} available
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2 mb-4">
        {(Object.entries(SOURCE_COLORS) as [string, typeof SOURCE_COLORS[keyof typeof SOURCE_COLORS]][]).map(([key, col]) => (
          <div key={key} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold"
            style={{ background: col.bg, border: `1px solid ${col.border}`, color: col.text }}>
            <div className="w-2 h-2 rounded-full" style={{ background: col.border }} />
            {col.label}
          </div>
        ))}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold"
          style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', color: '#6B7280' }}>
          <div className="w-2 h-2 rounded-full bg-gray-300" />
          Available
        </div>
      </div>

      {/* Slots */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {/* Column header */}
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--pearl)', background: 'var(--cream2)' }}>
          <div className="font-bold text-sm" style={{ color: 'var(--ink)' }}>
            {new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </div>
        </div>

        <div style={{ maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' }}>
          {slots.map((slot, i) => {
            const appt = getApptForSlot(slot)
            const src = appt ? detectSource(appt) : null
            const col = src ? SOURCE_COLORS[src] : null
            const isHourStart = slot.slotIdx === 0
            const timeLabel = formatSlotTime(slot.h, slot.m)

            return (
              <div
                key={i}
                className="flex"
                style={{ borderBottom: `1px solid ${isHourStart ? 'var(--pearl)' : '#F0F0F0'}`, minHeight: 44 }}
                onClick={appt ? e => showDetail(e, appt) : undefined}>

                {/* Time column */}
                <div className="flex items-center px-3 shrink-0"
                  style={{ width: 72, borderRight: '1px solid var(--pearl)', background: 'var(--cream2)' }}>
                  <span className={`text-${isHourStart ? 'xs' : '10px'} font-${isHourStart ? 'bold' : 'normal'}`}
                    style={{ color: isHourStart ? 'var(--mist)' : 'var(--silver)', fontSize: isHourStart ? 11 : 10 }}>
                    {timeLabel}
                  </span>
                </div>

                {/* Content */}
                <div className="flex-1 flex items-center px-3 transition-all cursor-default"
                  style={{
                    background: appt ? col!.bg : '#FAFAFA',
                    borderLeft: `3px solid ${appt ? col!.border : 'transparent'}`,
                    cursor: appt ? 'pointer' : 'default',
                  }}
                  onMouseOver={e => { if (appt) (e.currentTarget as HTMLElement).style.filter = 'brightness(0.96)' }}
                  onMouseOut={e => { if (appt) (e.currentTarget as HTMLElement).style.filter = '' }}>
                  {appt ? (
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold truncate" style={{ color: col!.text }}>
                        {appt.title.split(' - ')[0] || appt.title}
                      </div>
                    </div>
                  ) : (
                    <span className="text-xs italic" style={{ color: '#D1D5DB' }}>Available</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Detail popup */}
      {detail && (
        <ApptDetail
          appt={detail}
          tz={tz}
          pos={detailPos}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  )
}

/* ── APPOINTMENT DETAIL POPUP ── */
function ApptDetail({ appt, tz, pos, onClose }: {
  appt: Appointment
  tz: string
  pos: { x: number; y: number }
  onClose: () => void
}) {
  const src = detectSource(appt)
  const col = SOURCE_COLORS[src]
  const { name, phone, email, items, howHeard } = parseApptDetail(appt)

  return (
    <div
      className="fixed z-50 rounded-xl shadow-xl p-5 w-72"
      style={{
        left: pos.x, top: pos.y,
        background: 'var(--card-bg)',
        border: '1px solid var(--pearl)',
        borderTop: `3px solid ${col.border}`,
        pointerEvents: 'auto',
      }}
      onClick={e => e.stopPropagation()}>

      <div className="flex items-start justify-between mb-3">
        <div className="font-black text-sm" style={{ color: 'var(--ink)' }}>{name}</div>
        <button onClick={onClose} className="text-lg leading-none ml-2" style={{ color: 'var(--mist)' }}>×</button>
      </div>

      <div className="space-y-1.5 text-sm" style={{ color: 'var(--ash)' }}>
        <div>🕐 <strong>{timeInTz(appt.start, tz)}</strong> – {timeInTz(appt.end, tz)}</div>
        {phone && (
          <div>📞 <a href={`tel:${phone}`} className="font-bold" style={{ color: 'var(--green)' }}>{phone}</a></div>
        )}
        {email && (
          <div>✉ <a href={`mailto:${email}`} style={{ color: 'var(--green)', fontSize: 12 }}>{email}</a></div>
        )}
        {items && <div>💎 {items}</div>}
        {howHeard && (
          <div className="mt-2 px-3 py-2 rounded-lg text-xs font-bold"
            style={{ background: col.bg, color: col.text }}>
            📣 {howHeard}
          </div>
        )}
        {appt.location && (
          <div className="text-xs" style={{ color: 'var(--mist)' }}>📍 {appt.location}</div>
        )}
      </div>
    </div>
  )
}

/* ══ MOBILE ACTIVE APPOINTMENTS VIEW ══
 * Shown when the user is on mobile and currently assigned to an active
 * event. Auto-opens to today's day. Header is a tappable dropdown that
 * lists the user's other events + "Browse all events". Solid green day
 * bar with segmented Day 1/2/3 (TODAY label on the current day). Stats
 * strip shows booked / available / fill %. Hour-grouped appointment
 * list with each row fully tinted by its detected lead source.
 */
function MobileActiveAppointmentsView({
  ev, stores, myEvents, appointments, loading,
  onPickEvent, onBack, onRefresh,
}: {
  ev: Event
  stores: Store[]
  myEvents: Event[]
  appointments: Record<string, Appointment[]>
  loading: Record<string, boolean>
  onPickEvent: (eventId: string) => void
  onBack: () => void
  onRefresh: () => void
}) {
  const store = stores.find(s => s.id === ev.store_id)
  const tz = STATE_TZ[(store?.state || '').toUpperCase()] || 'America/New_York'
  const [day, setDay] = useState(1)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [dropdownOpen, setDropdownOpen] = useState(false)

  // Auto-select today if it's one of the event days.
  useEffect(() => {
    const todayInTz = dateInTz(new Date(), tz)
    for (let d = 1; d <= 3; d++) {
      if (getEventDayDate(ev.start_date, d) === todayInTz) { setDay(d); return }
    }
    setDay(1)
  }, [ev.id, ev.start_date, tz])

  const isLoading = loading[store?.id || '']
  const allAppts = appointments[store?.id || ''] || []
  const dateStr = getEventDayDate(ev.start_date, day)
  const dayAppts = allAppts.filter(a => dateInTz(a.start, tz) === dateStr)
  const slots = generateSlots()

  const findAppt = (slot: { h: number; m: number }) => dayAppts.find(a => {
    const { h, m } = hmInTz(a.start, tz)
    return Math.abs((h * 60 + m) - (slot.h * 60 + slot.m)) < 20
  })

  // Group slots by hour (10, 11, 12, …, 17).
  const byHour = new Map<number, typeof slots>()
  slots.forEach(s => {
    if (!byHour.has(s.h)) byHour.set(s.h, [])
    byHour.get(s.h)!.push(s)
  })

  const otherEvents = myEvents.filter(e => e.id !== ev.id)
    .sort((a, b) => b.start_date.localeCompare(a.start_date))
    .slice(0, 10)

  // Is this event actually happening right now? Controls the LIVE badge.
  const isLive = (() => {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const start = new Date(ev.start_date + 'T12:00:00')
    const end = new Date(ev.start_date + 'T12:00:00')
    end.setDate(end.getDate() + 2); end.setHours(23, 59, 59)
    return today >= start && today <= end
  })()

  const bookedToday = slots.filter(s => findAppt(s)).length
  const availToday  = slots.length - bookedToday
  const fillPct     = slots.length > 0 ? Math.round((bookedToday / slots.length) * 100) : 0

  const todayInStoreTz = dateInTz(new Date(), tz)

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {/* Dropdown header */}
      <div style={{
        padding: '12px 16px', background: 'var(--cream)',
        borderBottom: '1px solid var(--pearl)', position: 'relative',
      }}>
        <button onClick={() => setDropdownOpen(o => !o)} style={{
          width: '100%', padding: '8px 12px', borderRadius: 10,
          background: 'var(--cream2)', border: '1.5px solid var(--pearl)',
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
          textAlign: 'left',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 15, fontWeight: 900, color: 'var(--ink)' }}>
                {store?.name || ev.store_name}
              </span>
              {isLive && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '2px 8px', borderRadius: 99,
                  background: '#DC2626', color: '#fff',
                  fontSize: 9, fontWeight: 900, letterSpacing: '.08em',
                }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#fff' }} />
                  LIVE
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 2 }}>
              {store?.city}, {store?.state} · Day {day} of 3
            </div>
          </div>
          {isLoading && <span style={{ fontSize: 11, color: 'var(--mist)', marginRight: 4 }}>↻</span>}
          <span style={{ fontSize: 16, color: 'var(--green-dark)' }}>{dropdownOpen ? '▴' : '▾'}</span>
        </button>

        {dropdownOpen && (
          <div style={{
            position: 'absolute', top: 'calc(100% - 1px)', left: 12, right: 12,
            background: 'var(--cream)',
            border: '1.5px solid var(--pearl)', borderTop: 'none',
            borderRadius: '0 0 10px 10px',
            boxShadow: '0 8px 20px rgba(0,0,0,.12)', zIndex: 20,
            overflow: 'hidden',
          }}>
            {otherEvents.length === 0 ? (
              <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--mist)', fontStyle: 'italic' }}>
                No other events assigned to you.
              </div>
            ) : (
              otherEvents.map(other => {
                const otherStore = stores.find(s => s.id === other.store_id)
                return (
                  <button key={other.id}
                    onClick={() => { onPickEvent(other.id); setDropdownOpen(false) }}
                    style={{
                      width: '100%', padding: '10px 14px', background: 'none',
                      border: 'none', borderBottom: '1px solid var(--cream2)',
                      textAlign: 'left', cursor: 'pointer',
                    }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
                      {otherStore?.name || other.store_name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--mist)' }}>
                      {otherStore?.city}, {otherStore?.state} · {other.start_date}
                    </div>
                  </button>
                )
              })
            )}
            <button onClick={() => { onRefresh(); setDropdownOpen(false) }} style={{
              width: '100%', padding: '10px 14px', background: 'var(--cream2)',
              border: 'none', borderTop: '1px solid var(--pearl)',
              textAlign: 'left', cursor: 'pointer',
              fontSize: 12, fontWeight: 700, color: 'var(--mist)',
            }}>
              ↻ Refresh feed
            </button>
            <button onClick={() => { onBack(); setDropdownOpen(false) }} style={{
              width: '100%', padding: '10px 14px', background: 'var(--green-pale)',
              border: 'none', borderTop: '1px solid var(--pearl)',
              textAlign: 'left', cursor: 'pointer',
              fontSize: 12, fontWeight: 700, color: 'var(--green-dark)',
            }}>
              🔎 Browse all events →
            </button>
          </div>
        )}
      </div>

      {/* Solid green day bar */}
      <div style={{ padding: '10px 16px', background: 'var(--green)' }}>
        <div style={{ display: 'flex', background: 'rgba(0,0,0,.22)', borderRadius: 10, padding: 3 }}>
          {[1, 2, 3].map(d => {
            const active = day === d
            const isTodayDay = getEventDayDate(ev.start_date, d) === todayInStoreTz
            return (
              <button key={d} onClick={() => setDay(d)} style={{
                flex: 1, padding: '7px 0 6px', borderRadius: 8, border: 'none',
                background: active ? 'var(--cream)' : 'transparent',
                color: active ? 'var(--green-dark)' : 'rgba(255,255,255,.85)',
                fontSize: 13, fontWeight: 900, cursor: 'pointer',
                boxShadow: active ? '0 1px 3px rgba(0,0,0,.2)' : 'none',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
              }}>
                <span>Day {d}</span>
                {isTodayDay && (
                  <span style={{ fontSize: 9, fontWeight: 700, opacity: 0.85, letterSpacing: '.04em' }}>TODAY</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Stats strip */}
      {store?.calendar_feed_url && (
        <div style={{
          padding: '8px 16px', background: 'var(--cream2)',
          fontSize: 11, fontWeight: 700, color: 'var(--ash)',
          display: 'flex', gap: 14, borderBottom: '1px solid var(--pearl)',
        }}>
          <span><strong style={{ color: 'var(--green-dark)' }}>{bookedToday}</strong> booked</span>
          <span><strong style={{ color: 'var(--mist)' }}>{availToday}</strong> available</span>
          <span style={{ marginLeft: 'auto', color: 'var(--green)' }}>{fillPct}% full</span>
        </div>
      )}

      {/* Hour-grouped list with lead-source-tinted rows */}
      {store?.calendar_feed_url ? (
        <div style={{ flex: 1, overflowY: 'auto', background: 'var(--cream)' }}>
          {Array.from(byHour.entries()).map(([hour, hourSlots]) => {
            const bookedCount = hourSlots.filter(s => findAppt(s)).length
            const hourLabel = hour > 12 ? `${hour - 12} PM` : hour === 12 ? '12 PM' : `${hour} AM`
            return (
              <div key={hour}>
                <div style={{
                  padding: '6px 16px', background: 'var(--cream2)',
                  fontSize: 10, fontWeight: 900,
                  letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--mist)',
                  display: 'flex', justifyContent: 'space-between',
                }}>
                  <span>{hourLabel}</span>
                  <span>{bookedCount}/{hourSlots.length}</span>
                </div>
                {hourSlots.map(slot => {
                  const appt = findAppt(slot)
                  const key = `${hour}-${slot.m}`
                  const isOpen = expanded === key
                  const src = appt ? detectSource(appt) : null
                  const col = src ? SOURCE_COLORS[src] : null
                  const tintBg = appt && col ? col.bg : 'var(--cream)'
                  const detail = appt ? parseApptDetail(appt) : null
                  return (
                    <div key={key}
                      onClick={() => appt && setExpanded(isOpen ? null : key)}
                      style={{
                        background: tintBg,
                        borderBottom: '1px solid rgba(0,0,0,.04)',
                        padding: '10px 14px',
                        cursor: appt ? 'pointer' : 'default',
                        display: 'flex', gap: 10, alignItems: 'flex-start',
                      }}>
                      <div style={{
                        minWidth: 60, fontSize: 11, fontWeight: 800,
                        color: appt && col ? col.text : (appt ? 'var(--ink)' : 'var(--fog)'),
                        paddingTop: 1,
                      }}>{formatSlotTime(slot.h, slot.m)}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {appt && detail ? (
                          <>
                            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>
                              {detail.name || appt.title}
                            </div>
                            {col && (
                              <div style={{ fontSize: 10, color: col.text, fontWeight: 700, marginTop: 2 }}>
                                {col.label}
                              </div>
                            )}
                            {isOpen && (
                              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ash)', lineHeight: 1.6 }}>
                                <div>🕐 <strong>{timeInTz(appt.start, tz)}</strong> – {timeInTz(appt.end, tz)}</div>
                                {detail.phone && (
                                  <div>📞 <a href={`tel:${detail.phone}`} style={{ color: 'var(--green)', textDecoration: 'none', fontWeight: 700 }}>{detail.phone}</a></div>
                                )}
                                {detail.email && (
                                  <div>✉ <a href={`mailto:${detail.email}`} style={{ color: 'var(--green)', textDecoration: 'none' }}>{detail.email}</a></div>
                                )}
                                {detail.items && <div>💎 {detail.items}</div>}
                                {detail.howHeard && <div>📣 {detail.howHeard}</div>}
                              </div>
                            )}
                          </>
                        ) : (
                          <span style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--fog)' }}>Available</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
          <div>
            <div style={{ fontSize: 36, marginBottom: 8 }}>📅</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>No calendar feed</div>
            <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 4, maxWidth: 280 }}>
              This event's store hasn't set up a Google Calendar feed yet. Ask an admin to add one in Store Details.
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
