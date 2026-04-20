'use client'

import { useState, useEffect } from 'react'
import { useApp } from '@/lib/context'
import type { Event, BuyerVacation } from '@/types'
import { supabase } from '@/lib/supabase'

type ViewMode = 'month' | 'timeline' | 'agenda' | 'kanban'

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
  const { events, stores, users, user } = useApp()
  const [view, setView] = useState<ViewMode>('month')
  const [detail, setDetail] = useState<Event | null>(null)
  const [vacations, setVacations] = useState<BuyerVacation[]>([])
  const [showVacations, setShowVacations] = useState(() => {
    if (typeof window === 'undefined') return true
    return localStorage.getItem('beb-show-vacations') !== 'false'
  })

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
    { id: 'timeline', label: '▬  Timeline' },
    { id: 'agenda',   label: '☰  Agenda'   },
    { id: 'kanban',   label: '⊞  Kanban'   },
  ]

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)', margin: 0 }}>Calendar</h1>
          <div style={{ fontSize: 13, color: 'var(--mist)', marginTop: 2 }}>Visual planning view · {events.length} events</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={toggleShowVacations} style={{
          padding: '7px 12px', borderRadius: 'var(--r)', border: '1px solid var(--pearl)', cursor: 'pointer',
          fontSize: 12, fontWeight: 700, background: showVacations ? 'var(--cream2)' : 'transparent',
          color: showVacations ? 'var(--ash)' : 'var(--fog)',
        }}>
          ☀ Vacations {showVacations ? 'ON' : 'OFF'}
        </button>
        <div style={{ display: 'flex', gap: 4, background: 'var(--cream2)', padding: 4, borderRadius: 'var(--r)', border: '1px solid var(--pearl)' }}>
          {views.map(v => (
            <button key={v.id} onClick={() => setView(v.id)} style={{
              padding: '7px 16px', borderRadius: 'calc(var(--r) - 2px)', border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: 700, transition: 'all .15s',
              background: view === v.id ? 'var(--sidebar-bg)' : 'transparent',
              color: view === v.id ? '#fff' : 'var(--ash)',
            }}>{v.label}</button>
          ))}
        </div>
        </div>
      </div>

      {view === 'month'    && <MonthView    events={events} stores={stores} users={users} vacations={showVacations ? vacations : []} currentUserId={user?.id} onSelect={setDetail} />}
      {view === 'timeline' && <TimelineView events={events} stores={stores} onSelect={setDetail} />}
      {view === 'agenda'   && <AgendaView   events={events} stores={stores} onSelect={setDetail} />}
      {view === 'kanban'   && <KanbanView   events={events} stores={stores} onSelect={setDetail} />}

      {detail && <DetailModal ev={detail} stores={stores} onClose={() => setDetail(null)} />}
    </div>
  )
}

/* ══════════════════════════════════════════
   MONTH VIEW
══════════════════════════════════════════ */
function MonthView({ events, stores, users, vacations, currentUserId, onSelect }: { events: Event[]; stores: any[]; users: any[]; vacations: BuyerVacation[]; currentUserId?: string; onSelect: (e: Event) => void }) {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())

  const prev = () => month === 0 ? (setMonth(11), setYear(y => y-1)) : setMonth(m => m-1)
  const next = () => month === 11 ? (setMonth(0), setYear(y => y+1)) : setMonth(m => m+1)

  const firstDow = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month+1, 0).getDate()
  const cells: (number|null)[] = [...Array(firstDow).fill(null), ...Array.from({length: daysInMonth}, (_,i)=>i+1)]
  while (cells.length % 7) cells.push(null)

  const todayStr = today.toISOString().slice(0,10)
  const ds = (d: number) => `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`

  const eventsOnDay = (d: number) => events.filter(ev => evDays(ev).includes(ds(d)))

  const vacationsOnDay = (d: number) => {
    const dateStr = ds(d)
    return vacations.filter(v => dateStr >= v.start_date && dateStr <= v.end_date).map(v => {
      const u = users.find((x: any) => x.id === v.user_id)
      return { ...v, userName: u?.name?.split(' ')[0] || 'Unknown', isMe: v.user_id === currentUserId }
    })
  }

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', background: 'var(--sidebar-bg)' }}>
        <button onClick={prev} style={{ background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff', width: 30, height: 30, borderRadius: '50%', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
        <div style={{ fontWeight: 900, fontSize: 16, color: '#fff' }}>
          {new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </div>
        <button onClick={next} style={{ background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff', width: 30, height: 30, borderRadius: '50%', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
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
          return (
            <div key={i} style={{
              minHeight: 90, padding: '6px 6px',
              borderRight: '1px solid var(--cream2)', borderBottom: '1px solid var(--cream2)',
              background: !day ? 'rgba(0,0,0,.02)' : isToday ? 'rgba(45,106,79,.05)' : 'var(--cream)',
            }}>
              {day && (
                <>
                  <div style={{
                    width: 24, height: 24, borderRadius: '50%', fontSize: 12, fontWeight: isToday ? 900 : 400,
                    color: isToday ? '#fff' : 'var(--ash)', background: isToday ? 'var(--green)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 4,
                  }}>{day}</div>
                  {dayEvs.map(ev => (
                    <div key={ev.id} onClick={() => onSelect(ev)} style={{
                      background: storeColor(ev.store_id, stores), color: '#fff',
                      fontSize: 10, fontWeight: 700, padding: '2px 5px', borderRadius: 3,
                      marginBottom: 2, cursor: 'pointer', overflow: 'hidden',
                      whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                    }}>◆ {ev.store_name}</div>
                  ))}
                  {vacationsOnDay(day).map(v => (
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
    </div>
  )
}

/* ══════════════════════════════════════════
   TIMELINE VIEW
══════════════════════════════════════════ */
function TimelineView({ events, stores, onSelect }: { events: Event[]; stores: any[]; onSelect: (e: Event) => void }) {
  const today = new Date(); today.setHours(0,0,0,0)
  const [offset, setOffset] = useState(0)

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
function AgendaView({ events, stores, onSelect }: { events: Event[]; stores: any[]; onSelect: (e: Event) => void }) {
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
    <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 24, alignItems: 'start' }}>
      {/* Mini month index */}
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
              const dollars = ev.days.reduce((s,d) => s + (d.dollars10||0) + (d.dollars5||0), 0)
              const purchases = ev.days.reduce((s,d) => s + (d.purchases||0), 0)
              return (
                <div key={ev.id} onClick={() => onSelect(ev)} style={{
                  display: 'flex', gap: 14, alignItems: 'flex-start',
                  padding: '14px 16px', marginBottom: 8, borderRadius: 'var(--r)',
                  background: 'var(--cream)', border: `1px solid var(--pearl)`,
                  borderLeft: `4px solid ${color}`,
                  cursor: 'pointer', opacity: past ? 0.65 : 1,
                  transition: 'box-shadow .15s',
                }}>
                  {/* Date block */}
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
                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 900, fontSize: 15, color: 'var(--ink)', marginBottom: 2 }}>◆ {ev.store_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 6 }}>
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
                  {/* Stats */}
                  {ev.days.length > 0 && (
                    <div style={{ display: 'flex', gap: 16, flexShrink: 0 }}>
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
function KanbanView({ events, stores, onSelect }: { events: Event[]; stores: any[]; onSelect: (e: Event) => void }) {
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
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, alignItems: 'start' }}>
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
                const dollars = ev.days.reduce((s,d) => s + (d.dollars10||0) + (d.dollars5||0), 0)
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
                          <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--green)' }}>${Math.round(dollars).toLocaleString()}</div>
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
   DETAIL MODAL
══════════════════════════════════════════ */
function DetailModal({ ev, stores, onClose }: { ev: Event; stores: any[]; onClose: () => void }) {
  const store = stores.find(s => s.id === ev.store_id)
  const days = [...(ev.days||[])].sort((a,b) => a.day_number - b.day_number)
  const totalPurchases = days.reduce((s,d) => s + (d.purchases||0), 0)
  const totalCustomers = days.reduce((s,d) => s + (d.customers||0), 0)
  const totalDollars = days.reduce((s,d) => s + (d.dollars10||0) + (d.dollars5||0), 0)
  const totalCommission = days.reduce((s,d) => s + (d.dollars10||0)*0.10 + (d.dollars5||0)*0.05, 0)
  const closeRate = totalCustomers > 0 ? Math.round(totalPurchases/totalCustomers*100) : 0
  const color = storeColor(ev.store_id, stores)
  const fmt = (ds: string) => new Date(ds+'T12:00:00').toLocaleDateString('en-US', {weekday:'short', month:'short', day:'numeric'})
  const fmtDollars = (n: number) => `$${Math.round(n).toLocaleString()}`

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, overflowY: 'auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--cream)', borderRadius: 'var(--r2)', maxWidth: 580, width: '100%', boxShadow: 'var(--shadow-lg)' }}>
        {/* Header */}
        <div style={{ background: color, padding: '20px 24px', borderRadius: 'var(--r2) var(--r2) 0 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ color: 'rgba(255,255,255,.6)', fontSize: 12 }}>◆ Event Details</div>
            <div style={{ color: '#fff', fontSize: 18, fontWeight: 900, marginTop: 2 }}>{ev.store_name}</div>
            <div style={{ color: 'rgba(255,255,255,.6)', fontSize: 12, marginTop: 2 }}>{store?.city}, {store?.state} · {ev.start_date}</div>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,.2)', border: 'none', color: '#fff', width: 32, height: 32, borderRadius: '50%', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
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
                const dayDollars = (d.dollars10||0) + (d.dollars5||0)
                const dayCR = d.customers > 0 ? Math.round(d.purchases/d.customers*100) : 0
                return (
                  <div key={d.day_number} style={{ paddingBottom: 12, marginBottom: 12, borderBottom: '1px solid var(--cream2)' }}>
                    <div style={{ fontWeight: 700, color: 'var(--green)', marginBottom: 8, fontSize: 13 }}>
                      Day {d.day_number}{dayDateStr ? ` — ${fmt(dayDateStr)}` : ''}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, fontSize: 12 }}>
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
              <div className="card-title">Who Worked</div>
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
