'use client'

// "Next event" hero card for the dashboard. Used by both desktop and
// mobile dashboards — sources its data from useMyEvents() so the
// profile sheet can list the same events without a duplicate query.

import { useApp } from '@/lib/context'
import { useMyEvents, eventCountdown, formatEventRange } from '@/lib/useMyEvents'
import { eventDisplayName } from '@/lib/eventName'
import type { NavPage } from '@/app/page'

export default function NextEventCard({
  setNav, variant = 'desktop',
}: {
  setNav?: (n: NavPage) => void
  variant?: 'desktop' | 'mobile'
}) {
  const { stores } = useApp()
  const { nextEvent, loaded } = useMyEvents()

  if (!loaded) return null

  // Empty state
  if (!nextEvent) {
    return (
      <div style={{
        background: 'var(--card-bg, #fff)',
        border: '1px solid var(--pearl)',
        borderRadius: 12,
        padding: variant === 'mobile' ? '14px 16px' : '18px 20px',
        boxShadow: '0 2px 10px rgba(0,0,0,.04)',
        marginBottom: variant === 'mobile' ? 14 : 18,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 800, color: 'var(--mist)',
          textTransform: 'uppercase', letterSpacing: '.08em',
          marginBottom: 4,
        }}>Next event</div>
        <div style={{ fontSize: 14, color: 'var(--mist)' }}>
          No upcoming events scheduled.
        </div>
      </div>
    )
  }

  const store = stores.find(s => s.id === nextEvent.store_id)
  const cd = eventCountdown(nextEvent.start_date)
  const cityState = [store?.city, store?.state].filter(Boolean).join(', ')
  const range = formatEventRange(nextEvent.start_date)
  const secondary = [cityState, range].filter(Boolean).join(' · ')

  // Attention emphasis (Today / Day X of Y) gets a stronger amber hue.
  const badgeBg = cd.emphasis === 'attention' ? '#FEF3C7' : 'var(--green-pale)'
  const badgeFg = cd.emphasis === 'attention' ? '#92400E' : 'var(--green-dark)'
  const badgeBd = cd.emphasis === 'attention' ? '#FCD34D' : 'var(--green3)'

  return (
    <button
      onClick={() => setNav?.('events')}
      style={{
        width: '100%', textAlign: 'left', cursor: 'pointer',
        background: 'rgba(240,253,244,.95)',
        border: '1px solid var(--green3)',
        borderRadius: 12,
        padding: variant === 'mobile' ? '14px 16px' : '18px 20px',
        boxShadow: '0 2px 10px rgba(0,0,0,.08)',
        marginBottom: variant === 'mobile' ? 14 : 18,
        fontFamily: 'inherit',
        position: 'relative',
        display: 'flex', flexDirection: 'column', gap: 4,
      }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 800, color: 'var(--green-dark)',
          textTransform: 'uppercase', letterSpacing: '.08em',
          opacity: 0.7,
        }}>Next event</div>
        {cd.label && (
          <span style={{
            background: badgeBg, color: badgeFg, border: `1px solid ${badgeBd}`,
            padding: '3px 10px', borderRadius: 999,
            fontSize: 11, fontWeight: 800, letterSpacing: '.02em',
            whiteSpace: 'nowrap',
          }}>{cd.label}</span>
        )}
      </div>

      <div style={{
        fontSize: variant === 'mobile' ? 17 : 20,
        fontWeight: 900, color: 'var(--green-dark)',
        lineHeight: 1.15, marginTop: 2,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        overflow: 'hidden', wordBreak: 'break-word',
      }}>
        {eventDisplayName(nextEvent, stores)}
      </div>

      {secondary && (
        <div style={{
          fontSize: 12, color: 'var(--green-dark)', opacity: 0.7,
          marginTop: 2,
        }}>{secondary}</div>
      )}
    </button>
  )
}
