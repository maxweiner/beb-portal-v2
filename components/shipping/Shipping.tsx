'use client'

// Shipping module — top-level shell with two tabs. Styling lifted
// from the Marketing module (2026-05-16) so the chrome matches the
// rest of the app: page-level header inside an `p-6 max-w-6xl`
// frame, pill-shaped tab bar in a cream2 well, dark active state.
// EventReturnsTab + LegacyShipmentsTab render bare content now —
// the header lives here.

import { useState } from 'react'
import EventReturnsTab from './EventReturnsTab'
import LegacyShipmentsTab from './LegacyShipmentsTab'

type ShippingTab = 'event_returns' | 'log'

export default function Shipping() {
  const [tab, setTab] = useState<ShippingTab>('event_returns')

  const tabs: [ShippingTab, string][] = [
    ['event_returns', 'Event Returns'],
    ['log', 'Shipping Log'],
  ]

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div style={{ marginBottom: 16 }}>
        <h1 className="text-2xl font-black" style={{ color: 'var(--ink)' }}>📦 Shipping</h1>
        <div style={{ fontSize: 13, color: 'var(--mist)', marginTop: 4 }}>
          Track every event's box returns through ship, in transit, and received.
        </div>
      </div>

      {/* Pill-tab bar — same shape as Marketing's Campaigns / Settings
          tabs. Sits in a cream well, dark sidebar-bg color for the
          active pill, ash text for inactive. */}
      <div style={{
        display: 'flex', gap: 4, padding: 4, marginBottom: 16,
        background: 'var(--cream2)', borderRadius: 'var(--r)',
        border: '1px solid var(--pearl)', width: 'fit-content',
      }}>
        {tabs.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding: '6px 14px', borderRadius: 'calc(var(--r) - 2px)',
            border: 'none', cursor: 'pointer',
            fontSize: 12, fontWeight: 700,
            background: tab === id ? 'var(--sidebar-bg)' : 'transparent',
            color: tab === id ? '#fff' : 'var(--ash)',
            fontFamily: 'inherit',
          }}>{label}</button>
        ))}
      </div>

      {tab === 'event_returns' ? <EventReturnsTab /> : <LegacyShipmentsTab />}
    </div>
  )
}
