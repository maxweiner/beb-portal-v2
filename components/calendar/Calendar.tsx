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
  const { events, stores } = useApp()
  const [calState, setCalState] = useState<CalendarState>({
    appointments: {},
    loading: {},
    lastRefresh: null,
  })
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [selectedDay, setSelectedDay] = useState(1)

  // Get active events (within ±2 weeks)
  const activeEvents = events.filter(ev => {
    if (!ev.start_date) return false
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const start = new Date(ev.start_date + 'T12:00:00')
    const end = new Date(ev.start_date + 'T12:00:00'); end.setDate(end.getDate() + 2)
    const twoWeeks = 14 * 24 * 60 * 60 * 1000
    return (end.getTime() - today.getTime()) >= -twoWeeks && (start.getTime() - today.getTime()) <= twoWeeks
  })

  const fetchForStore = async (store: Store) => {
    if (!store.calendar_feed_url) return
    setCalState(prev => ({ ...prev, loading: { ...prev.loading, [store.id]: true } }))
    try {
      const res = await fetch(`/api/fetch-ical?url=${encodeURIComponent(store.calendar_feed_url)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      const appts = parseIcal(text)
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

  return (
    <div style={{ padding: "24px" }}>
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
function EventCards({ activeEvents, stores, appointments, loading, lastRefresh, onOpen, onRefreshAll }: {
  activeEvents: Event[]
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

          return (
            <div key={ev.id}
              className="rounded-xl p-5 cursor-pointer transition-all hover:shadow-md"
              style={{ background: 'var(--card-bg)', border: '1px solid var(--pearl)' }}
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
