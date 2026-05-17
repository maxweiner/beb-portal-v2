'use client'

// The big one — 6×7 month grid with three rendering paths:
//   1. Mobile: mini grid with day numbers + dots (tap a day to drill
//      into SelectedDayPanel below).
//   2. Desktop: per-week grid with connected bars for buying events,
//      trade shows, and trunk shows that share a global track stack.
//   3. Per-day decoration row beneath the bars for shipments + vacations.

import { useState } from 'react'
import type { Event, BuyerVacation } from '@/types'
import { eventStaffing } from '@/lib/eventStaffing'
import { CALENDAR_COLORS, eventChipStyle } from '@/lib/calendarColors'
import UnderstaffedBadge from '@/components/events/UnderstaffedBadge'
import {
  FAMILY_BUYING,
  buyingMainColor,
  evDays,
  tradeShowDays,
  trunkShowDays,
  computeWeekSegments,
} from './helpers'
import type { ShipmentEntry, TradeShowOverlay, TrunkShowOverlay } from './types'
import MiniDatePicker from './MiniDatePicker'
import SelectedDayPanel from './SelectedDayPanel'

export default function MonthView({ events, stores, users, vacations, currentUserId, onSelect, isNarrow, shipments, onSelectShipment, tradeShows = [], trunkShows = [], onOpenTradeShow, onOpenTrunkShow }: { events: Event[]; stores: any[]; users: any[]; vacations: BuyerVacation[]; currentUserId?: string; onSelect: (e: Event) => void; isNarrow: boolean; shipments: ShipmentEntry[]; onSelectShipment: (s: ShipmentEntry) => void; tradeShows?: TradeShowOverlay[]; trunkShows?: TrunkShowOverlay[]; onOpenTradeShow?: (id: string) => void; onOpenTrunkShow?: (id: string) => void }) {
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
  const tradesOnDay = (d: number) => tradeShows.filter(t => tradeShowDays(t).includes(ds(d)))
  const trunksOnDay = (d: number) => trunkShows.filter(t => trunkShowDays(t).includes(ds(d)))

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
        {/* Mobile path: one cell per day with dots — kept as-is. */}
        {isNarrow && cells.map((day, i) => {
          const dayEvs = day ? eventsOnDay(day) : []
          const isToday = day ? ds(day) === todayStr : false
          const dayShips = day ? shipmentsOnDay(day) : []
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
                      background: buyingMainColor(),
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
          return null
        })}
      </div>

      {/* Desktop month grid: each week is its own grid container so
          multi-day buying events / trade shows / trunk shows can render
          as continuous bars that span columns. */}
      {!isNarrow && (() => {
        // Split the 42-cell grid into 6 weeks of 7 cells each.
        const weeks: { days: { day: number | null; iso: string | null; isToday: boolean }[] }[] = []
        for (let w = 0; w < cells.length / 7; w++) {
          const days = []
          for (let c = 0; c < 7; c++) {
            const day = cells[w * 7 + c]
            const iso = day ? ds(day) : null
            days.push({ day, iso, isToday: iso === todayStr })
          }
          weeks.push({ days })
        }
        return (
          <div>
            {weeks.map((week, wIdx) => {
              const weekIsoDates = week.days.map(d => d.iso || '')
              // Compute connected-bar segments for each layer.
              const evSegs = computeWeekSegments(weekIsoDates, events, ev => {
                if (!ev.start_date) return { start: null, end: null }
                const days = evDays(ev)
                return { start: ev.start_date, end: days[days.length - 1] || ev.start_date }
              })
              const tradeSegs = computeWeekSegments(weekIsoDates, tradeShows, t => ({
                start: t.start_date, end: t.end_date,
              }))
              const trunkSegs = computeWeekSegments(weekIsoDates, trunkShows, t => ({
                start: t.start_date, end: t.end_date,
              }))
              // All bars share one stack of tracks so visually they
              // don't collide. Recompute global tracks across the merged
              // set.
              const merged = [
                ...tradeSegs.map(s => ({ ...s, kind: 'trade' as const })),
                ...trunkSegs.map(s => ({ ...s, kind: 'trunk' as const })),
                ...evSegs.map(s => ({ ...s, kind: 'event' as const })),
              ]
              merged.sort((a, b) => (b.span - a.span) || (a.startCol - b.startCol))
              const placed: typeof merged = []
              for (const s of merged) {
                let track = 0
                while (placed.some(p =>
                  p.track === track &&
                  !(s.startCol + s.span - 1 < p.startCol || s.startCol > p.startCol + p.span - 1)
                )) track++
                placed.push({ ...s, track })
              }
              const trackCount = placed.reduce((m, s) => Math.max(m, s.track + 1), 0)
              return (
                <div key={wIdx} style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(7, 1fr)',
                  position: 'relative',
                  borderBottom: '1px solid var(--cream2)',
                }}>
                  {/* Layer 1: per-day backgrounds (full week height) */}
                  {week.days.map((d, c) => (
                    <div key={`bg-${c}`} style={{
                      gridColumn: c + 1, gridRow: '1 / -1',
                      borderRight: c < 6 ? '1px solid var(--cream2)' : undefined,
                      background: !d.day ? 'rgba(0,0,0,.02)'
                                : d.isToday ? 'rgba(45,106,79,.05)'
                                : 'var(--cream)',
                      minHeight: 140,
                    }} />
                  ))}
                  {/* Layer 2: day numbers */}
                  {week.days.map((d, c) => (
                    <div key={`num-${c}`} style={{
                      gridColumn: c + 1, gridRow: 1,
                      padding: '6px 8px 4px', position: 'relative', zIndex: 1,
                    }}>
                      {d.day && (
                        <div style={{
                          width: 26, height: 26, borderRadius: '50%',
                          fontSize: 13, fontWeight: d.isToday ? 900 : 600,
                          color: d.isToday ? '#fff' : 'var(--ash)',
                          background: d.isToday ? 'var(--green)' : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>{d.day}</div>
                      )}
                    </div>
                  ))}
                  {/* Layer 3: connected bars */}
                  {placed.map((s, idx) => {
                    const trackRow = s.track + 2  // row 1 = day numbers
                    const isHead = s.isStart
                    const isTail = s.isEnd
                    if (s.kind === 'event') {
                      const ev = s.item as Event
                      const staffing = eventStaffing(ev)
                      const reserved = ev.status === 'reserved'
                      const chip = eventChipStyle(FAMILY_BUYING, reserved)
                      return (
                        <div key={`bar-ev-${idx}`} style={{
                          gridColumn: `${s.startCol + 1} / span ${s.span}`,
                          gridRow: trackRow, padding: '0 4px', zIndex: 1, position: 'relative',
                        }}>
                          <div
                            onClick={() => onSelect(ev)}
                            title={`${ev.store_name} — ${ev.start_date}${reserved ? ' (Save the Date)' : ''}`}
                            style={{
                              background: chip.background, color: chip.color, border: chip.border,
                              fontSize: 12, fontWeight: 700,
                              padding: '4px 8px',
                              borderTopLeftRadius:    isHead ? 4 : 0,
                              borderBottomLeftRadius: isHead ? 4 : 0,
                              borderTopRightRadius:    isTail ? 4 : 0,
                              borderBottomRightRadius: isTail ? 4 : 0,
                              marginBottom: 2, cursor: 'pointer',
                              overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                              lineHeight: 1.2,
                              borderLeftWidth:  isHead ? undefined : 0,
                              borderRightWidth: isTail ? undefined : 0,
                              position: 'relative',
                              paddingRight: staffing.understaffed && isTail ? 22 : 8,
                            }}>
                            {isHead && '◆ '}{isHead ? ev.store_name : ' '}
                            {staffing.understaffed && isTail && staffing.needed != null && (
                              <span style={{ position: 'absolute', top: 2, right: 2 }}>
                                <UnderstaffedBadge assigned={staffing.assigned} needed={staffing.needed} variant="icon" />
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    }
                    if (s.kind === 'trade') {
                      const t = s.item as TradeShowOverlay
                      return (
                        <div key={`bar-tr-${idx}`} style={{
                          gridColumn: `${s.startCol + 1} / span ${s.span}`,
                          gridRow: trackRow, padding: '0 4px', zIndex: 1, position: 'relative',
                        }}>
                          <div
                            onClick={onOpenTradeShow ? (e) => { e.stopPropagation(); onOpenTradeShow(t.id) } : undefined}
                            title={`Trade Show — ${t.name}\n${t.start_date} – ${t.end_date}${t.venue_city ? ` · ${t.venue_city}, ${t.venue_state || ''}` : ''}\nClick to open`}
                            style={{
                              background: CALENDAR_COLORS.trade.light,
                              color: CALENDAR_COLORS.trade.text,
                              border: `1px solid ${CALENDAR_COLORS.trade.main}`,
                              fontSize: 11, fontWeight: 700,
                              padding: '3px 7px',
                              borderTopLeftRadius:    isHead ? 4 : 0,
                              borderBottomLeftRadius: isHead ? 4 : 0,
                              borderTopRightRadius:    isTail ? 4 : 0,
                              borderBottomRightRadius: isTail ? 4 : 0,
                              borderLeftWidth:  isHead ? undefined : 0,
                              borderRightWidth: isTail ? undefined : 0,
                              marginBottom: 2,
                              overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                              lineHeight: 1.2,
                              cursor: onOpenTradeShow ? 'pointer' : 'default',
                            }}>
                            {isHead && '🎪 '}{isHead ? t.name : ' '}
                          </div>
                        </div>
                      )
                    }
                    // trunk
                    const t = s.item as TrunkShowOverlay
                    const rep = t.assigned_rep_id
                      ? users.find((u: any) => u.id === t.assigned_rep_id)?.name?.split(' ')[0]
                      : null
                    return (
                      <div key={`bar-ts-${idx}`} style={{
                        gridColumn: `${s.startCol + 1} / span ${s.span}`,
                        gridRow: trackRow, padding: '0 4px', zIndex: 1, position: 'relative',
                      }}>
                        <div
                          onClick={onOpenTrunkShow ? (e) => { e.stopPropagation(); onOpenTrunkShow(t.id) } : undefined}
                          title={`Trunk Show — ${t.store_name}\n${t.start_date} – ${t.end_date}${t.city ? ` · ${t.city}, ${t.state || ''}` : ''}${rep ? `\nRep: ${rep}` : '\nUnassigned'}\nClick to open`}
                          style={{
                            background: CALENDAR_COLORS.trunk.light,
                            color: CALENDAR_COLORS.trunk.text,
                            border: `1px solid ${CALENDAR_COLORS.trunk.main}`,
                            fontSize: 11, fontWeight: 700,
                            padding: '3px 7px',
                            borderTopLeftRadius:    isHead ? 4 : 0,
                            borderBottomLeftRadius: isHead ? 4 : 0,
                            borderTopRightRadius:    isTail ? 4 : 0,
                            borderBottomRightRadius: isTail ? 4 : 0,
                            borderLeftWidth:  isHead ? undefined : 0,
                            borderRightWidth: isTail ? undefined : 0,
                            marginBottom: 2,
                            overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                            lineHeight: 1.2,
                            cursor: onOpenTrunkShow ? 'pointer' : 'default',
                          }}>
                          {isHead && '💼 '}{isHead ? t.store_name + (rep ? ` · ${rep}` : '') : ' '}
                        </div>
                      </div>
                    )
                  })}
                  {/* Layer 4: per-day decorations (shipments + vacations)
                      below the bars. They live in their own grid row so
                      bars don't push them around. */}
                  {week.days.map((d, c) => {
                    if (!d.day) return null
                    const dayShips = shipmentsOnDay(d.day)
                    const dayVacs = vacationsOnDay(d.day)
                    if (dayShips.length === 0 && dayVacs.length === 0) return null
                    return (
                      <div key={`dec-${c}`} style={{
                        gridColumn: c + 1,
                        gridRow: trackCount + 2,
                        padding: '4px 8px 8px',
                        zIndex: 1, position: 'relative',
                        display: 'flex', flexDirection: 'column', gap: 2,
                      }}>
                        {dayShips.map(s => (
                          <div key={s.id}
                            onClick={() => onSelectShipment(s)}
                            title={`Time to ship ${s.store_name} — ${s.jewelry_box_count}J + ${s.silver_box_count}S`}
                            style={{
                              background: '#fff8eb', color: '#92400e',
                              border: '1px dashed #F59E0B',
                              fontSize: 11, fontWeight: 800,
                              padding: '3px 6px', borderRadius: 4,
                              cursor: 'pointer', overflow: 'hidden',
                              whiteSpace: 'nowrap', textOverflow: 'ellipsis', lineHeight: 1.2,
                            }}>📦 Ship {s.store_name}</div>
                        ))}
                        {dayVacs.map(v => (
                          <div key={v.id} title={v.note || 'Vacation'} style={{
                            fontSize: 9, padding: '1px 5px', borderRadius: 99,
                            background: v.isMe ? 'var(--green-pale)' : 'var(--cream2)',
                            color: v.isMe ? 'var(--green-dark)' : 'var(--mist)',
                            fontWeight: 700, alignSelf: 'flex-start', whiteSpace: 'nowrap',
                            border: v.isMe ? '1px solid var(--green3)' : '1px solid var(--pearl)',
                          }}>☀ {v.userName}</div>
                        ))}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )
      })()}

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
