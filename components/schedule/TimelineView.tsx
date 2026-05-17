'use client'

// 6-week gantt grid: 42 day columns × N rows (one per event/trunk show
// touching the visible range). Bars connect across days; first column
// of each bar shows the store name. Desktop-only — mobile gets a hint
// to switch to Agenda.

import { useState } from 'react'
import type { Event } from '@/types'
import { CALENDAR_COLORS } from '@/lib/calendarColors'
import { buyingMainColor, evDays, trunkShowDays } from './helpers'
import type { TrunkShowOverlay, ViewMode } from './types'

export default function TimelineView({ events, stores, onSelect, isNarrow, onSwitchView, trunkShows = [], users = [], onOpenTrunkShow }: { events: Event[]; stores: any[]; onSelect: (e: Event) => void; isNarrow: boolean; onSwitchView: (v: ViewMode) => void; trunkShows?: TrunkShowOverlay[]; users?: any[]; onOpenTrunkShow?: (id: string) => void }) {
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

  const visibleTrunks = trunkShows.filter(t => {
    const tds = trunkShowDays(t)
    return tds.some(d => d >= rangeStart && d <= rangeEnd)
  }).sort((a,b) => a.start_date.localeCompare(b.start_date))

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

        {visibleEvents.length === 0 && visibleTrunks.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--mist)' }}>No events in this range.</div>
        )}

        {visibleTrunks.map(t => {
          const tds = trunkShowDays(t)
          const repName = t.assigned_rep_id ? users.find((u: any) => u.id === t.assigned_rep_id)?.name?.split(' ')[0] : null
          return (
            <div key={`trunk-${t.id}`} style={{ display: 'grid', gridTemplateColumns: '160px repeat(42, 1fr)', borderBottom: '1px solid var(--cream2)', alignItems: 'center', minHeight: 44 }}>
              <div
                onClick={onOpenTrunkShow ? () => onOpenTrunkShow(t.id) : undefined}
                title={`Trunk Show — ${t.store_name}${repName ? ` · ${repName}` : ' · Unassigned'}`}
                style={{
                  padding: '8px 12px', fontSize: 12, fontWeight: 700, color: CALENDAR_COLORS.trunk.text,
                  overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                  cursor: onOpenTrunkShow ? 'pointer' : 'default',
                }}>
                💼 {t.store_name}{repName ? ` · ${repName}` : ''}
              </div>
              {days.map((d, i) => {
                const ds = dStr(d)
                const isShowDay = tds.includes(ds)
                const isFirst = ds === tds[0]
                const isLast = ds === tds[tds.length-1]
                const isToday = ds === todayStr
                return (
                  <div key={i} style={{ borderLeft: '1px solid var(--cream2)', height: 44, display: 'flex', alignItems: 'center', padding: '4px 1px', background: isToday ? 'rgba(45,106,79,.04)' : 'transparent' }}>
                    {isShowDay && (
                      <div onClick={onOpenTrunkShow ? () => onOpenTrunkShow(t.id) : undefined} style={{
                        flex: 1, height: 28, background: CALENDAR_COLORS.trunk.text, cursor: onOpenTrunkShow ? 'pointer' : 'default',
                        borderRadius: isFirst && isLast ? 6 : isFirst ? '6px 0 0 6px' : isLast ? '0 6px 6px 0' : 0,
                        display: 'flex', alignItems: 'center', paddingLeft: isFirst ? 6 : 0,
                        color: '#fff', fontSize: 10, fontWeight: 700,
                        overflow: 'hidden', whiteSpace: 'nowrap',
                        boxShadow: isFirst ? '0 1px 3px rgba(0,0,0,.2)' : 'none',
                      }}>
                        {isFirst && t.store_name}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}

        {visibleEvents.map(ev => {
          const eds = evDays(ev)
          const color = buyingMainColor()
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
