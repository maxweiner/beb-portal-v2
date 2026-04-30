'use client'

import { useState, useEffect, useMemo } from 'react'
import { useApp } from '@/lib/context'
import type { Event, BuyerVacation } from '@/types'
import { supabase } from '@/lib/supabase'
import EventShippingPanel from '@/components/shipping/EventShippingPanel'
import { eventStaffing } from '@/lib/eventStaffing'
import { fmtMoney } from '@/lib/format'
import { eventSpend, eventCommission, daySpend } from '@/lib/eventSpend'
import UnderstaffedBadge from '@/components/events/UnderstaffedBadge'

interface ShipmentEntry {
  id: string
  event_id: string
  store_id: string
  store_name: string
  ship_date: string
  jewelry_box_count: number
  silver_box_count: number
  status: string
  event_workers: { id: string; name: string }[]
  event_start_date: string
}

type ViewMode = 'month' | 'week' | 'day' | 'timeline' | 'agenda' | 'kanban'

const VIEW_KEY = 'beb-calendar-view'

function useIsNarrow(breakpoint = 768) {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= breakpoint
  )
  useEffect(() => {
    const handler = () => setNarrow(window.innerWidth <= breakpoint)
    handler()
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [breakpoint])
  return narrow
}

const COLORS = [
  '#2D6A4F','#1B4332','#40916C','#264653','#D62828',
  '#E76F51','#F4A261','#457B9D','#6D4C41','#7B2D8B',
]

function storeColor(storeId: string, stores: any[]) {
  const idx = stores.findIndex(s => s.id === storeId)
  return COLORS[Math.abs(idx) % COLORS.length]
}

function evDays(ev: Event): string[] {
  return [0,1,2].map(i => {
    const d = new Date(ev.start_date + 'T12:00:00')
    d.setDate(d.getDate() + i)
    return d.toISOString().slice(0,10)
  })
}

export default function Schedule() {
  const { events, stores, users, user, brand } = useApp()
  const [view, setView] = useState<ViewMode>('month')
  const [shipments, setShipments] = useState<ShipmentEntry[]>([])
  const [shipmentDetail, setShipmentDetail] = useState<ShipmentEntry | null>(null)

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

      {view === 'month'    && <MonthView    events={events} stores={stores} users={users} vacations={showVacations ? vacations : []} currentUserId={user?.id} onSelect={setDetail} isNarrow={isNarrow} shipments={shipments} onSelectShipment={setShipmentDetail} />}
      {view === 'week'     && <WeekView     events={events} stores={stores} onSelect={setDetail} isNarrow={isNarrow} />}
      {view === 'day'      && <DayView      events={events} stores={stores} onSelect={setDetail} isNarrow={isNarrow} />}
      {view === 'timeline' && <TimelineView events={events} stores={stores} onSelect={setDetail} isNarrow={isNarrow} onSwitchView={setView} />}
      {view === 'agenda'   && <AgendaView   events={events} stores={stores} onSelect={setDetail} isNarrow={isNarrow} />}
      {view === 'kanban'   && <KanbanView   events={events} stores={stores} onSelect={setDetail} isNarrow={isNarrow} />}

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

function ShipmentDrawer({ shipment, onClose }: { shipment: ShipmentEntry; onClose: () => void }) {
  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000,
        display: 'flex', justifyContent: 'flex-end',
      }}>
      <div style={{ width: 'min(720px, 95vw)', background: 'var(--cream)', height: '100%', overflowY: 'auto', padding: 18, boxShadow: '-8px 0 24px rgba(0,0,0,.18)' }}>
        <EventShippingPanel
          eventId={shipment.event_id}
          eventStartDate={shipment.event_start_date}
          eventWorkers={shipment.event_workers}
          onClose={onClose}
        />
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════
   MONTH VIEW
══════════════════════════════════════════ */
function MonthView({ events, stores, users, vacations, currentUserId, onSelect, isNarrow, shipments, onSelectShipment }: { events: Event[]; stores: any[]; users: any[]; vacations: BuyerVacation[]; currentUserId?: string; onSelect: (e: Event) => void; isNarrow: boolean; shipments: ShipmentEntry[]; onSelectShipment: (s: ShipmentEntry) => void }) {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [pickerOpen, setPickerOpen] = useState(false)
  // Mobile-only: which day in the grid is the user expanding right now.
  const [selectedDay, setSelectedDay] = useState<number | null>(today.getDate())

  const prev = () => month === 0 ? (setMonth(11), setYear(y => y-1)) : setMonth(m => m-1)
  const next = () => month === 11 ? (setMonth(0), setYear(y => y+1)) : setMonth(m => m+1)
  const goToToday = () => { setYear(today.getFullYear()); setMonth(today.getMonth()) }

  const firstDow = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month+1, 0).getDate()
  const cells: (number|null)[] = [...Array(firstDow).fill(null), ...Array.from({length: daysInMonth}, (_,i)=>i+1)]
  while (cells.length % 7) cells.push(null)

  const todayStr = today.toISOString().slice(0,10)
  const ds = (d: number) => `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`

  const eventsOnDay = (d: number) => events.filter(ev => evDays(ev).includes(ds(d)))
  const shipmentsOnDay = (d: number) => shipments.filter(s => s.ship_date === ds(d))

  const vacationsOnDay = (d: number) => {
    const dateStr = ds(d)
    return vacations.filter(v => dateStr >= v.start_date && dateStr <= v.end_date).map(v => {
      const u = users.find((x: any) => x.id === v.user_id)
      return { ...v, userName: u?.name?.split(' ')[0] || 'Unknown', isMe: v.user_id === currentUserId }
    })
  }

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', background: 'var(--sidebar-bg)', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={prev} aria-label="Previous month" style={{ background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff', width: 38, height: 38, borderRadius: '50%', cursor: 'pointer', fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
          <button onClick={goToToday} style={{ background: 'rgba(255,255,255,.18)', border: '1px solid rgba(255,255,255,.25)', color: '#fff', padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700, letterSpacing: '.04em' }}>Today</button>
        </div>
        <button onClick={() => setPickerOpen(o => !o)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontWeight: 900, fontSize: 16, color: '#fff', padding: '6px 12px', borderRadius: 8 }} onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,.1)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
          {new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} ▾
        </button>
        <button onClick={next} aria-label="Next month" style={{ background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff', width: 38, height: 38, borderRadius: '50%', cursor: 'pointer', fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>

        {pickerOpen && (
          <MiniDatePicker
            year={year}
            month={month}
            onPick={(y, m) => { setYear(y); setMonth(m); setPickerOpen(false) }}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', background: 'var(--cream2)', borderBottom: '1px solid var(--pearl)' }}>
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
          <div key={d} style={{ padding: '8px 0', textAlign: 'center', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--mist)' }}>{d}</div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)' }}>
        {cells.map((day, i) => {
          const dayEvs = day ? eventsOnDay(day) : []
          const isToday = day ? ds(day) === todayStr : false
          const dayVacs = day ? vacationsOnDay(day) : []
          const dayShips = day ? shipmentsOnDay(day) : []
          const visibleCount = isNarrow ? 2 : 5
          const overflow = dayEvs.length - visibleCount
          const isSelected = isNarrow && day === selectedDay
          // ── MOBILE: mini calendar with dots, tap to expand below ──
          if (isNarrow && day) {
            const visibleDots = dayEvs.slice(0, 3)
            const moreDots = Math.max(0, dayEvs.length - 3)
            return (
              <button
                key={i}
                onClick={() => setSelectedDay(day)}
                style={{
                  appearance: 'none', border: 'none',
                  fontFamily: 'inherit', cursor: 'pointer', padding: 0,
                  minHeight: 56,
                  borderRight: '1px solid var(--cream2)', borderBottom: '1px solid var(--cream2)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'center', gap: 4,
                  background: isSelected
                    ? 'var(--green-pale)'
                    : isToday ? 'rgba(45,106,79,.05)' : 'var(--cream)',
                }}
              >
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  fontSize: 13, fontWeight: isToday ? 900 : 600,
                  color: isToday ? '#fff' : isSelected ? 'var(--green-dark)' : 'var(--ash)',
                  background: isToday ? 'var(--green)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: isSelected && !isToday ? '1.5px solid var(--green)' : 'none',
                }}>{day}</div>
                <div style={{ display: 'flex', gap: 3, alignItems: 'center', minHeight: 6 }}>
                  {visibleDots.map(ev => (
                    <span key={ev.id} style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: storeColor(ev.store_id, stores),
                    }} />
                  ))}
                  {dayShips.length > 0 && (
                    <span style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: '#F59E0B', boxShadow: '0 0 0 1.5px #fff inset',
                    }} title={`${dayShips.length} ship date${dayShips.length === 1 ? '' : 's'}`} />
                  )}
                  {moreDots > 0 && (
                    <span style={{ fontSize: 8, fontWeight: 800, color: 'var(--mist)', marginLeft: 2 }}>
                      +{moreDots}
                    </span>
                  )}
                </div>
              </button>
            )
          }
          if (isNarrow && !day) {
            return (
              <div key={i} style={{
                minHeight: 56, background: 'rgba(0,0,0,.02)',
                borderRight: '1px solid var(--cream2)', borderBottom: '1px solid var(--cream2)',
              }} />
            )
          }
          return (
            <div key={i} style={{
              minHeight: 140, padding: '8px 8px',
              borderRight: '1px solid var(--cream2)', borderBottom: '1px solid var(--cream2)',
              background: !day ? 'rgba(0,0,0,.02)' : isToday ? 'rgba(45,106,79,.05)' : 'var(--cream)',
            }}>
              {day && (
                <>
                  <div style={{
                    width: 26, height: 26, borderRadius: '50%',
                    fontSize: 13, fontWeight: isToday ? 900 : 600,
                    color: isToday ? '#fff' : 'var(--ash)', background: isToday ? 'var(--green)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 4,
                  }}>{day}</div>
                  {dayEvs.slice(0, visibleCount).map(ev => {
                    const staffing = eventStaffing(ev)
                    return (
                      <div
                        key={ev.id}
                        onClick={() => onSelect(ev)}
                        title={`${ev.store_name} — ${ev.start_date}`}
                        style={{
                          position: 'relative',
                          background: storeColor(ev.store_id, stores), color: '#fff',
                          fontSize: 12, fontWeight: 700,
                          padding: '4px 7px', borderRadius: 4,
                          marginBottom: 3, cursor: 'pointer', overflow: 'hidden',
                          whiteSpace: 'nowrap', textOverflow: 'ellipsis', lineHeight: 1.2,
                          paddingRight: staffing.understaffed ? 22 : 7,
                        }}>
                        ◆ {ev.store_name}
                        {staffing.understaffed && staffing.needed != null && (
                          <span style={{ position: 'absolute', top: 2, right: 2 }}>
                            <UnderstaffedBadge assigned={staffing.assigned} needed={staffing.needed} variant="icon" />
                          </span>
                        )}
                      </div>
                    )
                  })}
                  {overflow > 0 && (
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mist)', padding: '2px 4px' }}>
                      +{overflow} more
                    </div>
                  )}
                  {dayShips.map(s => (
                    <div key={s.id}
                      onClick={() => onSelectShipment(s)}
                      title={`Time to ship ${s.store_name} — ${s.jewelry_box_count}J + ${s.silver_box_count}S`}
                      style={{
                        background: '#fff8eb', color: '#92400e',
                        border: '1px dashed #F59E0B',
                        fontSize: 11, fontWeight: 800,
                        padding: '3px 6px', borderRadius: 4, marginBottom: 3,
                        cursor: 'pointer', overflow: 'hidden',
                        whiteSpace: 'nowrap', textOverflow: 'ellipsis', lineHeight: 1.2,
                      }}>📦 Ship {s.store_name}</div>
                  ))}
                  {dayVacs.map(v => (
                    <div key={v.id} title={v.note || 'Vacation'} style={{
                      fontSize: 9, padding: '1px 5px', borderRadius: 99, marginTop: 2,
                      background: v.isMe ? 'var(--green-pale)' : 'var(--cream2)',
                      color: v.isMe ? 'var(--green-dark)' : 'var(--mist)',
                      fontWeight: 700, display: 'inline-block', whiteSpace: 'nowrap',
                      border: v.isMe ? '1px solid var(--green3)' : '1px solid var(--pearl)',
                    }}>☀ {v.userName}</div>
                  ))}
                </>
              )}
            </div>
          )
        })}
      </div>

      {/* Mobile-only: expanded events for the selected day */}
      {isNarrow && selectedDay && (
        <SelectedDayPanel
          dateStr={ds(selectedDay)}
          events={eventsOnDay(selectedDay)}
          stores={stores}
          vacations={vacationsOnDay(selectedDay)}
          onSelect={onSelect}
          shipments={shipmentsOnDay(selectedDay)}
          onSelectShipment={onSelectShipment}
        />
      )}
    </div>
  )
}

function SelectedDayPanel({ dateStr, events, stores, vacations, onSelect, shipments, onSelectShipment }: {
  dateStr: string
  events: Event[]
  stores: any[]
  vacations: any[]
  onSelect: (e: Event) => void
  shipments: ShipmentEntry[]
  onSelectShipment: (s: ShipmentEntry) => void
}) {
  const d = new Date(dateStr + 'T12:00:00')
  const heading = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  return (
    <div style={{ borderTop: '1px solid var(--pearl)', background: '#fff', padding: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)', marginBottom: 10 }}>{heading}</div>
      {shipments.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
          {shipments.map(s => (
            <button key={s.id} onClick={() => onSelectShipment(s)}
              style={{
                appearance: 'none', textAlign: 'left',
                background: '#fff8eb', border: '1px dashed #F59E0B',
                borderRadius: 8, padding: '10px 12px', cursor: 'pointer',
                fontFamily: 'inherit', color: '#92400e', fontWeight: 700, fontSize: 13,
              }}>
              📦 Time to ship {s.store_name}
              <div style={{ fontSize: 11, fontWeight: 600, color: '#a16207', marginTop: 2 }}>
                {s.jewelry_box_count} Jewelry · {s.silver_box_count} Silver
              </div>
            </button>
          ))}
        </div>
      )}
      {events.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--mist)', padding: '10px 0' }}>{shipments.length > 0 ? 'No other events.' : 'No events.'}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {events.map(ev => (
            <button
              key={ev.id}
              onClick={() => onSelect(ev)}
              style={{
                appearance: 'none', textAlign: 'left',
                background: '#fff', border: '1px solid var(--pearl)',
                borderLeft: `5px solid ${storeColor(ev.store_id, stores)}`,
                borderRadius: 8, padding: '10px 12px', cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <div style={{ fontWeight: 800, color: 'var(--ink)', fontSize: 14 }}>{ev.store_name}</div>
              <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 2 }}>
                {(() => {
                  const idx = evDays(ev).indexOf(dateStr) + 1
                  return idx > 0 ? `Day ${idx} of 3` : ''
                })()}
                {(ev.workers || []).length > 0 && (
                  <span> · Lead: <strong style={{ color: 'var(--ash)' }}>{(ev.workers as any[])[0].name}</strong></span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
      {vacations.length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {vacations.map((v: any) => (
            <span key={v.id} style={{
              fontSize: 11, padding: '3px 8px', borderRadius: 99,
              background: v.isMe ? 'var(--green-pale)' : 'var(--cream2)',
              color: v.isMe ? 'var(--green-dark)' : 'var(--mist)', fontWeight: 700,
            }}>☀ {v.userName}</span>
          ))}
        </div>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════
   TIMELINE VIEW
══════════════════════════════════════════ */
function TimelineView({ events, stores, onSelect, isNarrow, onSwitchView }: { events: Event[]; stores: any[]; onSelect: (e: Event) => void; isNarrow: boolean; onSwitchView: (v: ViewMode) => void }) {
  const today = new Date(); today.setHours(0,0,0,0)
  const [offset, setOffset] = useState(0)

  if (isNarrow) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '32px 20px' }}>
        <div style={{ fontSize: 36, marginBottom: 10 }}>▬</div>
        <div style={{ fontSize: 15, fontWeight: 900, color: 'var(--ink)', marginBottom: 6 }}>
          Timeline needs a wider screen
        </div>
        <div style={{ fontSize: 13, color: 'var(--mist)', marginBottom: 16, lineHeight: 1.5 }}>
          The 6-week gantt view doesn't fit on mobile. Agenda shows the same events in a scrollable list.
        </div>
        <button onClick={() => onSwitchView('agenda')} style={{
          padding: '12px 20px', borderRadius: 'var(--r)', border: 'none',
          background: 'var(--green)', color: '#fff', fontSize: 14, fontWeight: 700,
          cursor: 'pointer', minHeight: 44,
        }}>
          ☰  Switch to Agenda
        </button>
      </div>
    )
  }

  const start = new Date(today)
  start.setDate(today.getDate() - today.getDay() + offset * 7)

  const days = Array.from({length: 42}, (_, i) => {
    const d = new Date(start); d.setDate(start.getDate() + i); return d
  })

  const dStr = (d: Date) => d.toISOString().slice(0,10)
  const todayStr = today.toISOString().slice(0,10)

  const rangeStart = dStr(days[0])
  const rangeEnd = dStr(days[days.length-1])

  const visibleEvents = events.filter(ev => {
    const eds = evDays(ev)
    return eds.some(d => d >= rangeStart && d <= rangeEnd)
  }).sort((a,b) => a.start_date.localeCompare(b.start_date))

  const weeks = Array.from({length: 6}, (_, i) => days.slice(i*7, i*7+7))

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <button className="btn-outline btn-sm" onClick={() => setOffset(o => o-4)}>‹ Earlier</button>
        <button className="btn-outline btn-sm" onClick={() => setOffset(0)}>Today</button>
        <button className="btn-outline btn-sm" onClick={() => setOffset(o => o+4)}>Later ›</button>
        <span style={{ fontSize: 13, color: 'var(--mist)' }}>
          {days[0].toLocaleDateString('en-US', {month:'short',day:'numeric'})} – {days[days.length-1].toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric'})}
        </span>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {/* Day header row */}
        <div style={{ display: 'grid', gridTemplateColumns: '160px repeat(42, 1fr)', background: 'var(--sidebar-bg)', overflowX: 'auto' }}>
          <div style={{ padding: '8px 12px', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.5)', textTransform: 'uppercase' }}>Event</div>
          {days.map((d, i) => (
            <div key={i} style={{
              padding: '4px 2px', textAlign: 'center', fontSize: 10, fontWeight: dStr(d) === todayStr ? 900 : 400,
              color: dStr(d) === todayStr ? '#7EC8A0' : 'rgba(255,255,255,.5)',
              borderLeft: '1px solid rgba(255,255,255,.1)',
            }}>
              <div>{['S','M','T','W','T','F','S'][d.getDay()]}</div>
              <div style={{ fontSize: 11 }}>{d.getDate()}</div>
            </div>
          ))}
        </div>

        {visibleEvents.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--mist)' }}>No events in this range.</div>
        )}

        {visibleEvents.map(ev => {
          const eds = evDays(ev)
          const color = storeColor(ev.store_id, stores)
          return (
            <div key={ev.id} style={{ display: 'grid', gridTemplateColumns: '160px repeat(42, 1fr)', borderBottom: '1px solid var(--cream2)', alignItems: 'center', minHeight: 44 }}>
              <div style={{ padding: '8px 12px', fontSize: 12, fontWeight: 700, color: 'var(--green-dark)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                ◆ {ev.store_name}
              </div>
              {days.map((d, i) => {
                const ds = dStr(d)
                const isEventDay = eds.includes(ds)
                const isFirst = ds === eds[0]
                const isLast = ds === eds[eds.length-1]
                const isToday = ds === todayStr
                return (
                  <div key={i} style={{ borderLeft: '1px solid var(--cream2)', height: 44, display: 'flex', alignItems: 'center', padding: '4px 1px', background: isToday ? 'rgba(45,106,79,.04)' : 'transparent' }}>
                    {isEventDay && (
                      <div onClick={() => onSelect(ev)} style={{
                        flex: 1, height: 28, background: color, cursor: 'pointer',
                        borderRadius: isFirst && isLast ? 6 : isFirst ? '6px 0 0 6px' : isLast ? '0 6px 6px 0' : 0,
                        display: 'flex', alignItems: 'center',
                        paddingLeft: isFirst ? 6 : 0,
                        color: '#fff', fontSize: 10, fontWeight: 700,
                        overflow: 'hidden', whiteSpace: 'nowrap',
                        boxShadow: isFirst ? '0 1px 3px rgba(0,0,0,.2)' : 'none',
                      }}>
                        {isFirst && ev.store_name}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════
   AGENDA VIEW
══════════════════════════════════════════ */
function AgendaView({ events, stores, onSelect, isNarrow }: { events: Event[]; stores: any[]; onSelect: (e: Event) => void; isNarrow: boolean }) {
  const today = new Date(); today.setHours(0,0,0,0)
  const todayStr = today.toISOString().slice(0,10)

  const sorted = [...events].sort((a,b) => a.start_date.localeCompare(b.start_date))

  const grouped: Record<string, Event[]> = {}
  sorted.forEach(ev => {
    const key = ev.start_date.slice(0,7)
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(ev)
  })

  const fmtMonth = (k: string) => new Date(k+'-15').toLocaleDateString('en-US', {month:'long', year:'numeric'})
  const fmtDate = (ds: string) => new Date(ds+'T12:00:00').toLocaleDateString('en-US', {weekday:'short', month:'short', day:'numeric'})

  const isPast = (ev: Event) => new Date(ev.start_date+'T12:00:00') < today
  const isUpcoming = (ev: Event) => !isPast(ev)

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isNarrow ? '1fr' : '180px 1fr',
      gap: isNarrow ? 14 : 24, alignItems: 'start',
    }}>
      {/* Mini month index — desktop: sticky sidebar; mobile: horizontal scroll row */}
      {isNarrow ? (
        <div style={{
          display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4,
          WebkitOverflowScrolling: 'touch',
        }}>
          {Object.keys(grouped).map(k => (
            <a key={k} href={`#month-${k}`} style={{
              flexShrink: 0, padding: '8px 12px', borderRadius: 99,
              fontSize: 13, fontWeight: 700, textDecoration: 'none',
              color: k === todayStr.slice(0,7) ? 'var(--green-dark)' : 'var(--ash)',
              background: k === todayStr.slice(0,7) ? 'var(--green-pale)' : 'var(--cream2)',
              border: '1px solid var(--pearl)', minHeight: 36, display: 'inline-flex', alignItems: 'center',
            }}>
              {fmtMonth(k)} · {grouped[k].length}
            </a>
          ))}
        </div>
      ) : (
        <div className="card card-accent" style={{ margin: 0, position: 'sticky', top: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--mist)', marginBottom: 10 }}>Jump to Month</div>
          {Object.keys(grouped).map(k => (
            <a key={k} href={`#month-${k}`} style={{
              display: 'block', padding: '5px 8px', borderRadius: 6, fontSize: 13, fontWeight: 600,
              color: 'var(--green-dark)', textDecoration: 'none', marginBottom: 2,
              background: k === todayStr.slice(0,7) ? 'var(--green-pale)' : 'transparent',
            }}>
              {fmtMonth(k)}
              <span style={{ float: 'right', fontSize: 11, color: 'var(--mist)', fontWeight: 400 }}>{grouped[k].length}</span>
            </a>
          ))}
        </div>
      )}

      {/* Event list */}
      <div>
        {Object.entries(grouped).map(([monthKey, monthEvents]) => (
          <div key={monthKey} id={`month-${monthKey}`} style={{ marginBottom: 32 }}>
            <div style={{ fontSize: 13, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--green)', marginBottom: 12, paddingBottom: 8, borderBottom: '2px solid var(--green3)' }}>
              {fmtMonth(monthKey)}
            </div>
            {monthEvents.map(ev => {
              const past = isPast(ev)
              const color = storeColor(ev.store_id, stores)
              const dollars = eventSpend(ev)
              const purchases = ev.days.reduce((s,d) => s + (d.purchases||0), 0)
              return (
                <div key={ev.id} onClick={() => onSelect(ev)} style={{
                  display: 'flex',
                  flexDirection: isNarrow ? 'column' : 'row',
                  gap: isNarrow ? 10 : 14,
                  alignItems: isNarrow ? 'stretch' : 'flex-start',
                  padding: '14px 16px', marginBottom: 10, borderRadius: 'var(--r)',
                  background: 'var(--cream)', border: `1px solid var(--pearl)`,
                  borderLeft: `4px solid ${color}`,
                  cursor: 'pointer', opacity: past ? 0.65 : 1,
                  transition: 'box-shadow .15s',
                }}>
                  {/* Top row on mobile: date + info */}
                  <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flex: 1, minWidth: 0 }}>
                    <div style={{ textAlign: 'center', minWidth: 48, flexShrink: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--mist)' }}>
                        {new Date(ev.start_date+'T12:00:00').toLocaleDateString('en-US', {month:'short'})}
                      </div>
                      <div style={{ fontSize: 24, fontWeight: 900, color: 'var(--ink)', lineHeight: 1 }}>
                        {new Date(ev.start_date+'T12:00:00').getDate()}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--mist)' }}>
                        {new Date(ev.start_date+'T12:00:00').toLocaleDateString('en-US', {weekday:'short'})}
                      </div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 900, fontSize: 15, color: 'var(--ink)', marginBottom: 2 }}>◆ {ev.store_name}</div>
                      <div style={{ fontSize: 13, color: 'var(--mist)', marginBottom: 6 }}>
                        {fmtDate(ev.start_date)} — {fmtDate(evDays(ev)[2])}
                        {past && <span style={{ marginLeft: 8, fontSize: 10, background: 'var(--cream2)', padding: '1px 6px', borderRadius: 99, fontWeight: 700 }}>Past</span>}
                        {isUpcoming(ev) && <span style={{ marginLeft: 8, fontSize: 10, background: 'var(--green-pale)', color: 'var(--green-dark)', padding: '1px 6px', borderRadius: 99, fontWeight: 700 }}>Upcoming</span>}
                      </div>
                      {(ev.workers||[]).length > 0 && (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {(ev.workers||[]).map((w:any) => (
                            <span key={w.id} style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: 'var(--green-pale)', color: 'var(--green-dark)' }}>👤 {w.name}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Stats — side on desktop, below (full width row) on mobile */}
                  {ev.days.length > 0 && (
                    <div style={{
                      display: 'flex',
                      gap: 16,
                      flexShrink: 0,
                      justifyContent: isNarrow ? 'flex-start' : 'flex-end',
                      paddingTop: isNarrow ? 10 : 0,
                      borderTop: isNarrow ? '1px solid var(--cream2)' : 'none',
                      marginLeft: isNarrow ? 62 : 0,
                    }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--green)' }}>{purchases}</div>
                        <div style={{ fontSize: 10, color: 'var(--mist)' }}>Purchases</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--green)' }}>${Math.round(dollars/1000)}k</div>
                        <div style={{ fontSize: 10, color: 'var(--mist)' }}>Amount Spent</div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
        {Object.keys(grouped).length === 0 && (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--mist)' }}>No events yet.</div>
        )}
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════
   KANBAN VIEW
══════════════════════════════════════════ */
function KanbanView({ events, stores, onSelect, isNarrow }: { events: Event[]; stores: any[]; onSelect: (e: Event) => void; isNarrow: boolean }) {
  const today = new Date(); today.setHours(0,0,0,0)
  const weekMs = 7 * 24 * 60 * 60 * 1000

  const categorize = (ev: Event) => {
    const diff = new Date(ev.start_date+'T12:00:00').getTime() - today.getTime()
    if (diff >= -weekMs && diff <= weekMs) return 'current'
    if (diff > weekMs) return 'upcoming'
    return 'past'
  }

  const cols = [
    { id: 'upcoming', label: 'Upcoming', color: 'var(--green)', badge: 'badge-jade' },
    { id: 'current',  label: 'Current',  color: '#f59e0b',      badge: 'badge-gold' },
    { id: 'past',     label: 'Past',     color: 'var(--mist)',   badge: 'badge-silver' },
  ]

  const fmtDate = (ds: string) => new Date(ds+'T12:00:00').toLocaleDateString('en-US', {month:'short', day:'numeric'})

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isNarrow ? '1fr' : 'repeat(3,1fr)',
      gap: isNarrow ? 20 : 16, alignItems: 'start',
    }}>
      {cols.map(col => {
        const colEvents = events
          .filter(ev => categorize(ev) === col.id)
          .sort((a,b) => col.id === 'past'
            ? b.start_date.localeCompare(a.start_date)
            : a.start_date.localeCompare(b.start_date))

        return (
          <div key={col.id}>
            {/* Column header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: col.color }} />
              <div style={{ fontWeight: 900, fontSize: 14, color: 'var(--ink)' }}>{col.label}</div>
              <div style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--cream2)', color: 'var(--mist)' }}>
                {colEvents.length}
              </div>
            </div>

            {/* Cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {colEvents.map(ev => {
                const color = storeColor(ev.store_id, stores)
                const dollars = eventSpend(ev)
                const purchases = ev.days.reduce((s,d) => s + (d.purchases||0), 0)
                return (
                  <div key={ev.id} onClick={() => onSelect(ev)} style={{
                    background: 'var(--cream)', borderRadius: 'var(--r)',
                    border: '1px solid var(--pearl)', borderTop: `3px solid ${color}`,
                    padding: '12px 14px', cursor: 'pointer',
                    boxShadow: '0 1px 4px rgba(0,0,0,.06)',
                    transition: 'box-shadow .15s',
                  }}>
                    <div style={{ fontWeight: 900, fontSize: 13, color: 'var(--ink)', marginBottom: 4 }}>◆ {ev.store_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--mist)', marginBottom: 8 }}>
                      {fmtDate(ev.start_date)} – {fmtDate(evDays(ev)[2])}
                    </div>
                    {(ev.workers||[]).length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                        {(ev.workers||[]).map((w:any) => (
                          <span key={w.id} style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 99, background: 'var(--green-pale)', color: 'var(--green-dark)' }}>👤 {w.name}</span>
                        ))}
                      </div>
                    )}
                    {ev.days.length > 0 && (
                      <div style={{ display: 'flex', gap: 12, paddingTop: 8, borderTop: '1px solid var(--cream2)' }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--green)' }}>{purchases}</div>
                          <div style={{ fontSize: 9, color: 'var(--mist)', textTransform: 'uppercase' }}>Purchases</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--green)' }}>{fmtMoney(dollars)}</div>
                          <div style={{ fontSize: 9, color: 'var(--mist)', textTransform: 'uppercase' }}>Amount Spent</div>
                        </div>
                      </div>
                    )}
                    {ev.days.length === 0 && (
                      <div style={{ fontSize: 11, color: 'var(--silver)', fontStyle: 'italic' }}>No data entered yet</div>
                    )}
                  </div>
                )
              })}
              {colEvents.length === 0 && (
                <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--silver)', fontSize: 13 }}>None</div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ══════════════════════════════════════════
   DETAIL DRAWER (right-side slide-in)
══════════════════════════════════════════ */
function DetailModal({ ev, stores, onClose, isNarrow }: { ev: Event; stores: any[]; onClose: () => void; isNarrow: boolean }) {
  const store = stores.find(s => s.id === ev.store_id)
  const days = [...(ev.days||[])].sort((a,b) => a.day_number - b.day_number)
  const totalPurchases = days.reduce((s,d) => s + (d.purchases||0), 0)
  const totalCustomers = days.reduce((s,d) => s + (d.customers||0), 0)
  const totalDollars = eventSpend(ev)
  const totalCommission = eventCommission(ev)
  const closeRate = totalCustomers > 0 ? Math.round(totalPurchases/totalCustomers*100) : 0
  const color = storeColor(ev.store_id, stores)
  const fmt = (ds: string) => new Date(ds+'T12:00:00').toLocaleDateString('en-US', {weekday:'short', month:'short', day:'numeric'})
  const fmtDollars = fmtMoney

  // Esc closes the drawer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--cream)', height: '100%',
        width: isNarrow ? '100%' : 460, maxWidth: '100%',
        boxShadow: '-12px 0 32px rgba(0,0,0,.18)',
        overflowY: 'auto',
        animation: 'beb-drawer-in .22s cubic-bezier(.2,.8,.2,1)',
      }}>
        <style>{`@keyframes beb-drawer-in { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>
        {/* Header */}
        <div style={{ background: color, padding: '20px 24px', borderRadius: 'var(--r2) var(--r2) 0 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ color: 'rgba(255,255,255,.6)', fontSize: 12 }}>◆ Event Details</div>
            <div style={{ color: '#fff', fontSize: 18, fontWeight: 900, marginTop: 2 }}>{ev.store_name}</div>
            <div style={{ color: 'rgba(255,255,255,.6)', fontSize: 12, marginTop: 2 }}>{store?.city}, {store?.state} · {ev.start_date}</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'rgba(255,255,255,.2)', border: 'none', color: '#fff', width: 44, height: 44, borderRadius: '50%', fontSize: 22, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Summary */}
          <div className="card card-accent" style={{ margin: 0 }}>
            <div className="card-title">Event Summary</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {[
                ['Customers', totalCustomers.toLocaleString()],
                ['Purchases', totalPurchases.toLocaleString()],
                ['Close Rate', `${closeRate}%`],
                ['💰 Amount Spent', fmtDollars(totalDollars)],
                ['Commission Due', fmtDollars(totalCommission)],
                ['Days Entered', `${days.length} of 3`],
              ].map(([label, value]) => (
                <div key={label}>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--mist)', marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--ink)' }}>{value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Day breakdown */}
          {days.length > 0 && (
            <div className="card card-accent" style={{ margin: 0 }}>
              <div className="card-title">Day by Day</div>
              {days.map(d => {
                const dayDate = new Date(ev.start_date+'T12:00:00')
                dayDate.setDate(dayDate.getDate() + d.day_number - 1)
                const dayDateStr = isNaN(dayDate.getTime()) ? '' : dayDate.toISOString().slice(0,10)
                const dayDollars = daySpend(d)
                const dayCR = d.customers > 0 ? Math.round(d.purchases/d.customers*100) : 0
                return (
                  <div key={d.day_number} style={{ paddingBottom: 12, marginBottom: 12, borderBottom: '1px solid var(--cream2)' }}>
                    <div style={{ fontWeight: 700, color: 'var(--green)', marginBottom: 8, fontSize: 13 }}>
                      Day {d.day_number}{dayDateStr ? ` — ${fmt(dayDateStr)}` : ''}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: isNarrow ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap: 8, fontSize: 13 }}>
                      {[['Customers', d.customers||0], ['Purchases', d.purchases||0], ['Amount Spent', fmtDollars(dayDollars)], ['Close', `${dayCR}%`]].map(([l,v]) => (
                        <div key={l as string}>
                          <div style={{ color: 'var(--mist)', fontSize: 10, marginBottom: 2 }}>{l}</div>
                          <div style={{ fontWeight: 700 }}>{v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Workers */}
          {(ev.workers||[]).length > 0 && (
            <div className="card card-accent" style={{ margin: 0 }}>
              <div className="card-title">Buyers</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(ev.workers||[]).map((w:any) => (
                  <span key={w.id} className="badge badge-jade">{w.name}</span>
                ))}
              </div>
            </div>
          )}

          {/* Ad Spend */}
          {(ev.spend_vdp||ev.spend_newspaper||ev.spend_postcard||ev.spend_spiffs) ? (
            <div className="card card-accent" style={{ margin: 0 }}>
              <div className="card-title">Ad Spend & Spiffs</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[['VDP', ev.spend_vdp], ['Newspaper', ev.spend_newspaper], ['Postcard', ev.spend_postcard], ['Spiffs', ev.spend_spiffs]].map(([l,v]) => v ? (
                  <div key={l as string}>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--mist)', marginBottom: 2 }}>{l}</div>
                    <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--ink)' }}>{fmtDollars(Number(v))}</div>
                  </div>
                ) : null)}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════
   MINI DATE PICKER (popover from header)
══════════════════════════════════════════ */
function MiniDatePicker({ year, month, onPick, onClose }: {
  year: number
  month: number
  onPick: (year: number, month: number) => void
  onClose: () => void
}) {
  const [pickYear, setPickYear] = useState(year)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

  return (
    <>
      {/* Click-outside backdrop */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 998, background: 'transparent' }} />
      <div style={{
        position: 'absolute', top: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)',
        zIndex: 999, background: '#fff', borderRadius: 10,
        boxShadow: '0 12px 30px rgba(0,0,0,.18)',
        padding: 14, width: 260,
        color: 'var(--ink)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <button onClick={() => setPickYear(y => y - 1)} aria-label="Previous year"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--ash)' }}>‹</button>
          <div style={{ fontWeight: 800, fontSize: 14 }}>{pickYear}</div>
          <button onClick={() => setPickYear(y => y + 1)} aria-label="Next year"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--ash)' }}>›</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
          {months.map((m, i) => {
            const sel = pickYear === year && i === month
            return (
              <button key={m} onClick={() => onPick(pickYear, i)} style={{
                padding: '8px 0', borderRadius: 6, border: 'none',
                background: sel ? 'var(--green)' : 'transparent',
                color: sel ? '#fff' : 'var(--ash)',
                fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                transition: 'background .12s',
              }}
              onMouseEnter={e => { if (!sel) (e.currentTarget.style.background = 'var(--cream2)') }}
              onMouseLeave={e => { if (!sel) (e.currentTarget.style.background = 'transparent') }}
              >{m}</button>
            )
          })}
        </div>
      </div>
    </>
  )
}

/* ══════════════════════════════════════════
   WEEK VIEW (Sun-start, multi-day continuous bars)
══════════════════════════════════════════ */
function WeekView({ events, stores, onSelect, isNarrow }: { events: Event[]; stores: any[]; onSelect: (e: Event) => void; isNarrow: boolean }) {
  const today = new Date()
  // Anchor = Sunday of the displayed week.
  const sundayOf = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - x.getDay()); return x }
  const [anchor, setAnchor] = useState<Date>(sundayOf(today))

  const goPrev = () => setAnchor(d => { const x = new Date(d); x.setDate(x.getDate() - 7); return x })
  const goNext = () => setAnchor(d => { const x = new Date(d); x.setDate(x.getDate() + 7); return x })
  const goToday = () => setAnchor(sundayOf(today))

  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(anchor); d.setDate(anchor.getDate() + i); return d
  })
  const weekStart = weekDates[0]
  const weekEnd = weekDates[6]
  const todayStr = today.toISOString().slice(0, 10)
  const weekStartStr = weekStart.toISOString().slice(0, 10)
  const weekEndStr = weekEnd.toISOString().slice(0, 10)

  // For each event, compute which segment of the week it covers (start col, end col).
  // Events span 3 days from start_date.
  type Lane = { ev: Event; startCol: number; endCol: number }[]
  const lanes: Lane[] = []
  // Sort events by start so layout is stable.
  const weekEvents = events
    .map(ev => {
      const evStart = ev.start_date
      const endDate = new Date(ev.start_date + 'T12:00:00'); endDate.setDate(endDate.getDate() + 2)
      const evEndStr = endDate.toISOString().slice(0, 10)
      // Skip events not overlapping this week.
      if (evEndStr < weekStartStr || evStart > weekEndStr) return null
      const startCol = Math.max(0, weekDates.findIndex(d => d.toISOString().slice(0, 10) >= evStart))
      const endCol = Math.min(6, (() => {
        // Find last day of event still within the week
        const n = weekDates.findIndex(d => d.toISOString().slice(0, 10) > evEndStr)
        return n === -1 ? 6 : n - 1
      })())
      // findIndex can return -1 when evStart < weekStart; clamp to 0.
      const sCol = startCol === -1 ? 0 : startCol
      return { ev, startCol: sCol, endCol: Math.max(sCol, endCol) }
    })
    .filter((x): x is { ev: Event; startCol: number; endCol: number } => x !== null)
    .sort((a, b) => a.startCol - b.startCol || b.endCol - a.endCol)

  // Stack into lanes — first lane that has no overlap gets the bar.
  for (const item of weekEvents) {
    let placed = false
    for (const lane of lanes) {
      const conflict = lane.some(x => !(item.endCol < x.startCol || item.startCol > x.endCol))
      if (!conflict) { lane.push(item); placed = true; break }
    }
    if (!placed) lanes.push([item])
  }

  const dayHeader = (d: Date, i: number) => {
    const isToday = d.toISOString().slice(0, 10) === todayStr
    return (
      <div key={i} style={{
        padding: '12px 8px', textAlign: 'center', borderRight: '1px solid var(--cream2)',
        background: isToday ? 'rgba(45,106,79,.05)' : 'var(--cream2)',
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--mist)' }}>
          {d.toLocaleDateString('en-US', { weekday: 'short' })}
        </div>
        <div style={{
          marginTop: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 30, height: 30, borderRadius: '50%',
          background: isToday ? 'var(--green)' : 'transparent',
          color: isToday ? '#fff' : 'var(--ash)',
          fontWeight: 800, fontSize: 14,
        }}>{d.getDate()}</div>
      </div>
    )
  }

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', background: 'var(--sidebar-bg)' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={goPrev} aria-label="Previous week" style={{ background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff', width: 38, height: 38, borderRadius: '50%', cursor: 'pointer', fontSize: 20 }}>‹</button>
          <button onClick={goToday} style={{ background: 'rgba(255,255,255,.18)', border: '1px solid rgba(255,255,255,.25)', color: '#fff', padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>Today</button>
        </div>
        <div style={{ fontWeight: 900, fontSize: 16, color: '#fff' }}>
          {weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
        <button onClick={goNext} aria-label="Next week" style={{ background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff', width: 38, height: 38, borderRadius: '50%', cursor: 'pointer', fontSize: 20 }}>›</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)' }}>
        {weekDates.map((d, i) => dayHeader(d, i))}
      </div>

      {/* Bar lanes */}
      <div style={{ padding: '12px 0', minHeight: 200, position: 'relative', background: 'var(--cream)' }}>
        {lanes.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--mist)', fontSize: 13 }}>No events this week.</div>
        ) : lanes.map((lane, laneIdx) => (
          <div key={laneIdx} style={{
            display: 'grid', gridTemplateColumns: 'repeat(7,1fr)',
            position: 'relative', minHeight: 36, marginBottom: 6,
          }}>
            {/* Empty cells just for grid spacing */}
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i} style={{ borderRight: '1px solid var(--cream2)' }} />
            ))}
            {/* Absolutely positioned bars on top of the grid */}
            {lane.map(({ ev, startCol, endCol }) => {
              const left = (startCol / 7) * 100
              const width = ((endCol - startCol + 1) / 7) * 100
              return (
                <div
                  key={ev.id}
                  onClick={() => onSelect(ev)}
                  title={`${ev.store_name} — ${ev.start_date}`}
                  style={{
                    position: 'absolute', top: 0, height: 32,
                    left: `calc(${left}% + 4px)`, width: `calc(${width}% - 8px)`,
                    background: storeColor(ev.store_id, stores), color: '#fff',
                    borderRadius: 6, padding: '6px 10px',
                    fontSize: 13, fontWeight: 700, lineHeight: 1.4,
                    cursor: 'pointer', overflow: 'hidden', whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis', boxShadow: '0 1px 2px rgba(0,0,0,.08)',
                  }}>
                  ◆ {ev.store_name}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════
   DAY VIEW (single column, deep detail)
══════════════════════════════════════════ */
function DayView({ events, stores, onSelect, isNarrow }: { events: Event[]; stores: any[]; onSelect: (e: Event) => void; isNarrow: boolean }) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const [date, setDate] = useState<Date>(today)

  const goPrev = () => setDate(d => { const x = new Date(d); x.setDate(x.getDate() - 1); return x })
  const goNext = () => setDate(d => { const x = new Date(d); x.setDate(x.getDate() + 1); return x })
  const goToday = () => setDate(today)

  const dateStr = date.toISOString().slice(0, 10)
  const dayEvents = events.filter(ev => evDays(ev).includes(dateStr))
  const isToday = dateStr === new Date().toISOString().slice(0, 10)

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', background: 'var(--sidebar-bg)' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={goPrev} aria-label="Previous day" style={{ background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff', width: 38, height: 38, borderRadius: '50%', cursor: 'pointer', fontSize: 20 }}>‹</button>
          <button onClick={goToday} style={{ background: 'rgba(255,255,255,.18)', border: '1px solid rgba(255,255,255,.25)', color: '#fff', padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>Today</button>
        </div>
        <div style={{ fontWeight: 900, fontSize: 16, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
          {date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          {isToday && <span style={{ background: 'var(--green)', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 800 }}>TODAY</span>}
        </div>
        <button onClick={goNext} aria-label="Next day" style={{ background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff', width: 38, height: 38, borderRadius: '50%', cursor: 'pointer', fontSize: 20 }}>›</button>
      </div>

      <div style={{ padding: 24, background: 'var(--cream)' }}>
        {dayEvents.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--mist)', fontSize: 14 }}>
            No events on {date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {dayEvents.map(ev => {
              const store = stores.find((s: any) => s.id === ev.store_id)
              const days = ev.days || []
              const totalCustomers = days.reduce((s: number, d: any) => s + (d.customers || 0), 0)
              const totalPurchases = days.reduce((s: number, d: any) => s + (d.purchases || 0), 0)
              const which = evDays(ev).indexOf(dateStr) + 1
              return (
                <div
                  key={ev.id}
                  onClick={() => onSelect(ev)}
                  style={{
                    background: '#fff', borderRadius: 10, padding: 16,
                    borderLeft: `6px solid ${storeColor(ev.store_id, stores)}`,
                    cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,.06)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>{ev.store_name}</div>
                      <span style={{
                        fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 4,
                        background: 'var(--cream2)', color: 'var(--mist)',
                      }}>DAY {which} OF 3</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--mist)' }}>
                      {store?.city ? `${store.city}, ${store.state || ''}` : '—'}
                      {(ev.workers || []).length > 0 && (
                        <span> · Lead: <strong style={{ color: 'var(--ash)' }}>{(ev.workers as any[])[0].name}</strong></span>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 11, color: 'var(--mist)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>Customers · Purchases</div>
                    <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--ink)' }}>
                      {totalCustomers.toLocaleString()} · {totalPurchases.toLocaleString()}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

