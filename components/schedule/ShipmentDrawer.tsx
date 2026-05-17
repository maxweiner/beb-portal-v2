'use client'

// Right-side drawer that opens when the user taps a "📦 Ship STORE"
// chip on any calendar view. Wraps EventShippingPanel — the same
// panel the Shipping module uses — so the experience is identical
// regardless of where you opened it from.

import EventShippingPanel from '@/components/shipping/EventShippingPanel'
import type { ShipmentEntry } from './types'

export default function ShipmentDrawer({ shipment, onClose }: { shipment: ShipmentEntry; onClose: () => void }) {
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
