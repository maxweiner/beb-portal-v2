'use client'

// Sun-start week with continuous multi-day bars. Events that span across
// the week boundary get clipped at the edge; events that overlap inside
// the week get stacked into lanes by a greedy packer.

import { useState } from 'react'
import type { Event } from '@/types'
import { buyingMainColor } from './helpers'

export default function WeekView({ events, stores, onSelect, isNarrow }: { events: Event[]; stores: any[]; onSelect: (e: Event) => void; isNarrow: boolean }) {
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
                    background: buyingMainColor(), color: '#fff',
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
