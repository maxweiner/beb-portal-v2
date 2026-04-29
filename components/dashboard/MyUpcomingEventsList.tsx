'use client'

// Shared "My upcoming events" list used inside the desktop profile
// popover and the mobile profile sheet. Sources from useMyEvents()
// (same hook as the Next Event card). Lazy-toggles past events via
// "Show past events" link so the default view is just the
// soonest-first upcoming list.

import { useState } from 'react'
import { useApp } from '@/lib/context'
import { useMyEvents, formatEventRange } from '@/lib/useMyEvents'
import { eventDisplayName } from '@/lib/eventName'
import type { Event } from '@/types'

export default function MyUpcomingEventsList({
  onOpenEvent,
}: {
  onOpenEvent: (ev: Event) => void
}) {
  const { stores } = useApp()
  const { upcomingEvents, pastEvents, loaded } = useMyEvents()
  const [showPast, setShowPast] = useState(false)

  if (!loaded) return null

  const renderRow = (ev: Event, isPast?: boolean) => {
    const store = stores.find(s => s.id === ev.store_id)
    const cityState = [store?.city, store?.state].filter(Boolean).join(', ')
    const range = formatEventRange(ev.start_date)
    const secondary = [cityState, range].filter(Boolean).join(' · ')
    return (
      <button key={ev.id}
        onClick={() => onOpenEvent(ev)}
        style={{
          // display:block overrides the global `button { display:inline-flex;
          // justify-content:center }` rule, which was centering the store
          // name and squishing the city/date onto the same row.
          display: 'block',
          width: '100%', textAlign: 'left', cursor: 'pointer',
          background: 'transparent', border: 'none',
          padding: '10px 12px', fontFamily: 'inherit',
          borderTop: '1px solid var(--cream2)',
          opacity: isPast ? 0.7 : 1,
        }}>
        <div style={{
          fontSize: 13, fontWeight: 800, color: 'var(--ink)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{eventDisplayName(ev, stores)}</div>
        {secondary && (
          <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 2 }}>
            {secondary}
          </div>
        )}
      </button>
    )
  }

  return (
    <div>
      <div style={{
        fontSize: 11, fontWeight: 800, color: 'var(--ash)',
        textTransform: 'uppercase', letterSpacing: '.06em',
        padding: '0 12px 6px',
      }}>
        My upcoming events
      </div>

      <div style={{
        background: '#fff', border: '1px solid var(--cream2)',
        borderRadius: 8, overflow: 'hidden',
      }}>
        {upcomingEvents.length === 0 ? (
          <div style={{ padding: '12px', fontSize: 13, color: 'var(--mist)', fontStyle: 'italic' }}>
            No upcoming events scheduled.
          </div>
        ) : (
          <div>
            {upcomingEvents.map(ev => renderRow(ev))}
          </div>
        )}

        {showPast && pastEvents.length > 0 && (
          <div>
            <div style={{
              fontSize: 10, fontWeight: 800, color: 'var(--mist)',
              textTransform: 'uppercase', letterSpacing: '.06em',
              padding: '8px 12px 2px',
              background: 'var(--cream)',
              borderTop: '1px solid var(--cream2)',
            }}>
              Past events
            </div>
            {pastEvents.map(ev => renderRow(ev, true))}
          </div>
        )}
      </div>

      {pastEvents.length > 0 && (
        <button
          onClick={() => setShowPast(v => !v)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--green-dark)', fontSize: 11, fontWeight: 700,
            textDecoration: 'underline', padding: '8px 12px 0',
            fontFamily: 'inherit',
          }}>
          {showPast ? 'Hide past events' : `Show past events (${pastEvents.length})`}
        </button>
      )}
    </div>
  )
}
