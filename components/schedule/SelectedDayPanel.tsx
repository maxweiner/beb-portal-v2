'use client'

// Mobile-only: when the user taps a day in the MonthView mini-grid,
// this panel slides in below it with the full event list for that
// day (plus any ship dates or vacation chips). Desktop renders bars
// directly in the grid, so this isn't used there.

import type { Event } from '@/types'
import type { ShipmentEntry } from './types'
import { buyingMainColor, evDays } from './helpers'

export default function SelectedDayPanel({ dateStr, events, stores, vacations, onSelect, shipments, onSelectShipment }: {
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
                borderLeft: `5px solid ${buyingMainColor()}`,
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
