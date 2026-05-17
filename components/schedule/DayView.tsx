'use client'

// Single-day view: list of buying events that touch the chosen date
// with their customer/purchase totals. Header has ◂ Today ▸ paging.

import { useState } from 'react'
import type { Event } from '@/types'
import { buyingMainColor, evDays } from './helpers'

export default function DayView({ events, stores, onSelect, isNarrow }: { events: Event[]; stores: any[]; onSelect: (e: Event) => void; isNarrow: boolean }) {
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
                    borderLeft: `6px solid ${buyingMainColor()}`,
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
