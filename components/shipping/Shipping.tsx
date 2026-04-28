'use client'

import { useState } from 'react'
import EventReturnsTab from './EventReturnsTab'
import LegacyShipmentsTab from './LegacyShipmentsTab'

type ShippingTab = 'event_returns' | 'log'

export default function Shipping() {
  const [tab, setTab] = useState<ShippingTab>('event_returns')

  return (
    <div>
      <div style={{
        borderBottom: '1px solid var(--pearl)',
        padding: '12px 24px 0',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
      }}>
        {([
          ['event_returns', '📦 Event Returns'],
          ['log', '🚚 Shipping Log'],
        ] as const).map(([id, label]) => {
          const sel = tab === id
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              style={{
                background: sel ? '#fff' : 'transparent',
                border: 'none',
                borderBottom: sel ? '2px solid var(--green)' : '2px solid transparent',
                padding: '10px 16px',
                cursor: 'pointer',
                fontWeight: 800,
                fontSize: 13,
                color: sel ? 'var(--green-dark)' : 'var(--mist)',
                fontFamily: 'inherit',
                borderRadius: '6px 6px 0 0',
                marginBottom: -1,
              }}
            >{label}</button>
          )
        })}
      </div>

      {tab === 'event_returns' ? <EventReturnsTab /> : <LegacyShipmentsTab />}
    </div>
  )
}
