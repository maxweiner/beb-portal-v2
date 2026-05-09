'use client'

/**
 * Sidebar entry point for the Buy Intake flow.
 *
 * IntakeCaptureFlow needs an event_id, so when launched from the sidebar
 * (rather than from a Hub event card), we show a small picker of the
 * user's relevant events. Mirrors MobileLayout's getActiveEventId() to
 * preselect today's event when there's an obvious one.
 */

import { useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import { eventDisplayName } from '@/lib/eventName'
import { eventEndIso, formatEventRange } from '@/lib/eventDates'
import IntakeCaptureFlow from './IntakeCaptureFlow'
import IntakeWorksheet from './IntakeWorksheet'
import type { Event } from '@/types'

type IntakeMode = 'capture' | 'worksheet'

export default function IntakePage() {
  const { user, events, stores } = useApp()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin' || user?.is_partner === true
  const [openFor, setOpenFor] = useState<{ eventId: string; mode: IntakeMode } | null>(null)

  const todayIso = new Date().toISOString().slice(0, 10)

  const myEvents = useMemo(() => {
    if (!events) return []
    return events
      .filter(ev => ev.status !== 'cancelled' && ev.status !== 'reserved')
      .filter(ev => isAdmin || (ev.workers || []).some((w: any) => w.id === user?.id))
      .filter(ev => !!ev.start_date)
      .sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''))
  }, [events, isAdmin, user?.id])

  const liveEvents = myEvents.filter(ev => ev.start_date! <= todayIso && eventEndIso(ev.start_date!) >= todayIso)
  const upcomingEvents = myEvents.filter(ev => ev.start_date! > todayIso)
  const recentPast = myEvents
    .filter(ev => eventEndIso(ev.start_date!) < todayIso)
    .slice(-5)
    .reverse()

  if (myEvents.length === 0) {
    return (
      <div className="p-6" style={{ maxWidth: 800, margin: '0 auto' }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, margin: '0 0 4px' }}>🪪 Buy Intake</h1>
        <div style={{ color: 'var(--mist)', fontSize: 13, marginBottom: 16 }}>
          You have no events assigned. Ask an admin to add you to a buying event before scanning intakes.
        </div>
      </div>
    )
  }

  return (
    <div className="p-6" style={{ maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 900, margin: '0 0 4px' }}>🪪 Buy Intake</h1>
      <div style={{ color: 'var(--mist)', fontSize: 13, marginBottom: 18 }}>
        Pick the event you're working, then start a new intake or open today's worksheet.
      </div>

      {liveEvents.length > 0 && (
        <Section title="Live now">
          {liveEvents.map(ev => (
            <EventRow key={ev.id} ev={ev} stores={stores} highlight onCapture={() => setOpenFor({ eventId: ev.id, mode: 'capture' })} onWorksheet={() => setOpenFor({ eventId: ev.id, mode: 'worksheet' })} />
          ))}
        </Section>
      )}

      {upcomingEvents.length > 0 && (
        <Section title="Upcoming">
          {upcomingEvents.slice(0, 6).map(ev => (
            <EventRow key={ev.id} ev={ev} stores={stores} onCapture={() => setOpenFor({ eventId: ev.id, mode: 'capture' })} onWorksheet={() => setOpenFor({ eventId: ev.id, mode: 'worksheet' })} />
          ))}
        </Section>
      )}

      {recentPast.length > 0 && (
        <Section title="Recent past">
          {recentPast.map(ev => (
            <EventRow key={ev.id} ev={ev} stores={stores} dim onCapture={() => setOpenFor({ eventId: ev.id, mode: 'capture' })} onWorksheet={() => setOpenFor({ eventId: ev.id, mode: 'worksheet' })} />
          ))}
        </Section>
      )}

      {openFor?.mode === 'capture' && (
        <IntakeCaptureFlow
          eventId={openFor.eventId}
          onClose={() => setOpenFor(null)}
          onSaved={() => setOpenFor(null)}
        />
      )}

      {openFor?.mode === 'worksheet' && (() => {
        const ev = myEvents.find(e => e.id === openFor.eventId)
        if (!ev) { setOpenFor(null); return null }
        return (
          <IntakeWorksheet
            eventId={ev.id}
            storeId={ev.store_id}
            eventStartDate={ev.start_date}
            eventDisplayName={eventDisplayName(ev, stores)}
            onClose={() => setOpenFor(null)}
          />
        )
      })()}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </div>
  )
}

function EventRow({
  ev, stores, highlight, dim, onCapture, onWorksheet,
}: {
  ev: Event
  stores: ReturnType<typeof useApp>['stores']
  highlight?: boolean
  dim?: boolean
  onCapture: () => void
  onWorksheet: () => void
}) {
  const store = stores.find(s => s.id === ev.store_id)
  return (
    <div style={{
      background: '#fff',
      border: highlight ? '2px solid var(--green)' : '1px solid var(--pearl)',
      borderRadius: 10, padding: '14px 16px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 12, flexWrap: 'wrap',
      opacity: dim ? 0.7 : 1,
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>{eventDisplayName(ev, stores)}</div>
        <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 2 }}>
          {store?.city}{store?.state ? `, ${store.state}` : ''} · {ev.start_date ? formatEventRange(ev.start_date) : ''}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onWorksheet} style={secondaryBtn}>📋 Worksheet</button>
        <button onClick={onCapture} style={primaryBtn}>🪪 New intake</button>
      </div>
    </div>
  )
}

const primaryBtn: React.CSSProperties = {
  padding: '10px 14px', borderRadius: 8, fontWeight: 800, fontSize: 13,
  background: 'var(--green)', color: '#fff', border: 'none',
  cursor: 'pointer', fontFamily: 'inherit',
}
const secondaryBtn: React.CSSProperties = {
  padding: '10px 14px', borderRadius: 8, fontWeight: 700, fontSize: 13,
  background: '#fff', color: 'var(--ink)', border: '1px solid var(--pearl)',
  cursor: 'pointer', fontFamily: 'inherit',
}
