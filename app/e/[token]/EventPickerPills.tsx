'use client'

// Client-rendered event-picker pills + top-of-page loading bar.
//
// The pills used to be plain <a href="/e/{token}?ev=…"> tags inside
// the server component, which meant clicking one triggered a full
// HTML doc navigation — visible 1-2s blank window during the server
// re-render, no progress signal.
//
// Now: each pill triggers a client-side router.push() wrapped in
// useTransition(), and we show a sliding-gradient progress bar at
// the very top of the viewport (Vercel / Stripe / YouTube pattern)
// while isPending. The prior event's KPIs stay visible underneath
// until the new render is ready, then they swap atomically.
//
// All of the styling/label logic lives here so page.tsx no longer
// has to render any pill JSX itself.

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'

interface EligibleEvent {
  id: string
  start_date: string | null
  status: string | null
}

interface Props {
  token: string
  events: EligibleEvent[]
  selectedEventId: string
  today: string  // YYYY-MM-DD
}

/** Inline copy of the helpers from page.tsx — we need them here too
 *  and the page module doesn't export them. Kept tiny on purpose. */
function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function daysBetween(aIso: string, bIso: string): number {
  const a = new Date(aIso + 'T12:00:00').getTime()
  const b = new Date(bIso + 'T12:00:00').getTime()
  return Math.round((b - a) / (24 * 60 * 60 * 1000))
}
function eventPickerLabel(ev: EligibleEvent, today: string): string {
  const start = ev.start_date as string
  const endIso = addDays(start, 2)
  const d = new Date(start + 'T12:00:00')
  const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  if (ev.status === 'cancelled') return `${dateStr} · cancelled`
  if (ev.status === 'reserved') return `${dateStr} · save the date`
  if (start <= today && endIso >= today) {
    const day = Math.max(0, Math.min(2, daysBetween(start, today))) + 1
    return `${dateStr} · LIVE · Day ${day}`
  }
  if (endIso < today) {
    const ago = daysBetween(endIso, today)
    return ago === 0 ? `${dateStr} · just ended` : `${dateStr} · wrapped`
  }
  const days = daysBetween(today, start)
  if (days === 0) return `${dateStr} · starts today`
  if (days === 1) return `${dateStr} · in 1 day`
  return `${dateStr} · in ${days} days`
}

export default function EventPickerPills({ token, events, selectedEventId, today }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  if (events.length <= 1) return null

  return (
    <>
      {/* ── Top-of-viewport progress bar.
          Renders only while a navigation is pending. Pure CSS — a
          single sliding gradient sweep, ~1.4s loop. Pinned at top:0
          with z-index above everything so it shows over the blue
          header card too. ── */}
      {isPending && (
        <>
          <div className="evt-switch-bar-track" aria-hidden="true">
            <div className="evt-switch-bar-fill" />
          </div>
          <style>{`
            .evt-switch-bar-track {
              position: fixed;
              top: 0; left: 0; right: 0;
              height: 3px;
              background: rgba(29, 107, 68, 0.12);
              z-index: 9999;
              overflow: hidden;
              pointer-events: none;
            }
            .evt-switch-bar-fill {
              position: absolute;
              inset: 0;
              background: linear-gradient(
                90deg,
                transparent 0%,
                #1D6B44 35%,
                #4CA579 50%,
                #1D6B44 65%,
                transparent 100%
              );
              animation: evt-switch-bar-slide 1.4s ease-in-out infinite;
            }
            @keyframes evt-switch-bar-slide {
              0%   { transform: translateX(-100%); }
              100% { transform: translateX(100%); }
            }
          `}</style>
        </>
      )}

      <div style={{
        background: '#fff', borderRadius: 10, padding: '10px 14px',
        marginBottom: 12, boxShadow: '0 1px 3px rgba(0,0,0,.04)',
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: '#6b7280', letterSpacing: '.05em', textTransform: 'uppercase' }}>
          Event:
        </span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {events.map((e) => {
            const isSelected = e.id === selectedEventId
            const pillStr = eventPickerLabel(e, today)
            const eStart = e.start_date as string
            const eEnd = addDays(eStart, 2)
            const isPast = eEnd < today && e.status !== 'reserved'
            const bg = isSelected ? '#1e3a8a' : isPast ? '#E5E7EB' : '#F3F4F6'
            const fg = isSelected ? '#fff' : isPast ? '#6B7280' : '#374151'
            const border = isSelected ? '1px solid #1e3a8a' : isPast ? '1px solid #D1D5DB' : '1px solid #E5E7EB'
            const href = `/e/${token}?ev=${e.id}`
            return (
              <a key={e.id}
                href={href}
                title={isPast ? 'Past event — click to view historical data' : undefined}
                onClick={(ev) => {
                  // Modifier-click / middle-click → let the browser handle it
                  // (open in new tab). Only intercept plain left-clicks.
                  if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return
                  ev.preventDefault()
                  if (isSelected) return
                  startTransition(() => { router.push(href) })
                }}
                style={{
                  padding: '5px 10px', borderRadius: 6,
                  fontSize: 12, fontWeight: 700, textDecoration: 'none',
                  background: bg, color: fg, border,
                  // Faint visual feedback on the clicked pill while loading.
                  opacity: isPending && !isSelected ? 0.6 : 1,
                  cursor: isSelected ? 'default' : 'pointer',
                  transition: 'opacity .15s ease',
                }}>
                {pillStr}
              </a>
            )
          })}
        </div>
      </div>
    </>
  )
}
