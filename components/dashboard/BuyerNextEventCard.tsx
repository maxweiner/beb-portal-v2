'use client'

// Three-column "Next Event" card for buyers: Event | Flight | Hotel.
// Pulls travel_reservations for the next event (type=flight, type=hotel)
// scoped to the signed-in buyer. Empty states render a soft "Not booked
// yet" panel so the layout stays balanced. Stacks on mobile.

import { useEffect, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import { useMyEvents, eventCountdown, formatEventRange } from '@/lib/useMyEvents'
import { eventDisplayName } from '@/lib/eventName'
import type { NavPage } from '@/app/page'

interface Reservation {
  id: string
  type: 'flight' | 'hotel' | 'rental_car'
  vendor: string | null
  confirmation_number: string | null
  details: any
  check_in: string | null
  check_out: string | null
  departure_at: string | null
  arrival_at: string | null
}

function nightCount(checkIn: string | null, checkOut: string | null): number | null {
  if (!checkIn || !checkOut) return null
  const a = new Date(checkIn + 'T12:00:00').getTime()
  const b = new Date(checkOut + 'T12:00:00').getTime()
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null
  return Math.max(0, Math.round((b - a) / 86400000))
}

function fmtDayDate(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}
function fmtTime(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export default function BuyerNextEventCard({
  setNav, variant = 'desktop',
}: {
  setNav?: (n: NavPage) => void
  variant?: 'desktop' | 'mobile'
}) {
  const { user, stores } = useApp()
  const { nextEvent, loaded } = useMyEvents()
  const [reservations, setReservations] = useState<Reservation[]>([])

  useEffect(() => {
    let cancelled = false
    if (!nextEvent?.id || !user?.id) { setReservations([]); return }
    ;(async () => {
      const { data } = await supabase
        .from('travel_reservations')
        .select('id, type, vendor, confirmation_number, details, check_in, check_out, departure_at, arrival_at')
        .eq('event_id', nextEvent.id)
        .eq('buyer_id', user.id)
        .in('type', ['flight', 'hotel'])
      if (cancelled) return
      setReservations((data || []) as Reservation[])
    })()
    return () => { cancelled = true }
  }, [nextEvent?.id, user?.id])

  if (!loaded) return null
  if (!nextEvent) return <EmptyShell variant={variant} />

  const flight = reservations.find(r => r.type === 'flight') || null
  const hotel  = reservations.find(r => r.type === 'hotel')  || null
  const store = stores.find(s => s.id === nextEvent.store_id)
  const cd = eventCountdown(nextEvent.start_date)
  const cityState = [store?.city, store?.state].filter(Boolean).join(', ')
  const range = formatEventRange(nextEvent.start_date)

  const isMobile = variant === 'mobile'

  return (
    <div style={{
      background: 'var(--green-pale, #f0fdf4)',
      border: '1px solid var(--green3)',
      borderRadius: 14,
      padding: isMobile ? '14px 16px' : '20px 24px',
      marginBottom: isMobile ? 14 : 18,
      boxShadow: '0 2px 10px rgba(0,0,0,.06)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 10, marginBottom: 12,
        fontSize: 11, fontWeight: 800, letterSpacing: '.06em',
        color: 'var(--green-dark)', textTransform: 'uppercase',
      }}>
        <span style={{ opacity: 0.85 }}>Next Event</span>
        {cd.label && (
          <span style={{
            border: '1px solid var(--green3)', borderRadius: 999,
            padding: '2px 10px', fontSize: 11,
            background: 'rgba(255,255,255,.6)',
          }}>{cd.label}</span>
        )}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
        gap: 0,
        background: '#fff',
        border: '1px solid var(--green3)',
        borderRadius: 12,
        overflow: 'hidden',
      }}>
        <Cell variant={variant} icon="📍" label="Event" first>
          <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--green-dark)', lineHeight: 1.2 }}>
            {eventDisplayName(nextEvent, stores)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--green-dark)', opacity: 0.7, marginTop: 4 }}>
            {cityState}
            {cityState && range ? <br /> : null}
            {range}
          </div>
          <button onClick={() => setNav?.('events')} style={{
            marginTop: 8, background: 'transparent', border: 'none',
            padding: 0, color: 'var(--green)', fontSize: 11,
            fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            textDecoration: 'underline',
          }}>Open event →</button>
        </Cell>

        <Cell variant={variant} icon="✈" label="Flight" empty={!flight}>
          {flight ? (
            <FlightDetails r={flight} />
          ) : (
            <div style={{ fontSize: 13, color: 'var(--mist)', fontStyle: 'italic', fontWeight: 600 }}>
              Not booked yet
            </div>
          )}
        </Cell>

        <Cell variant={variant} icon="🛏" label="Hotel" empty={!hotel}>
          {hotel ? (
            <HotelDetails r={hotel} />
          ) : (
            <div style={{ fontSize: 13, color: 'var(--mist)', fontStyle: 'italic', fontWeight: 600 }}>
              Not booked yet
            </div>
          )}
        </Cell>
      </div>
    </div>
  )
}

function Cell({
  children, icon, label, empty, first, variant,
}: {
  children: React.ReactNode
  icon: string
  label: string
  empty?: boolean
  first?: boolean
  variant: 'desktop' | 'mobile'
}) {
  const isMobile = variant === 'mobile'
  return (
    <div style={{
      padding: '12px 14px',
      textAlign: 'center',
      borderLeft: !first && !isMobile ? '1px solid var(--green3)' : 'none',
      borderTop: !first && isMobile ? '1px solid var(--green3)' : 'none',
      opacity: empty ? 0.85 : 1,
    }}>
      <div style={{ fontSize: 16, marginBottom: 2 }}>{icon}</div>
      <div style={{
        fontSize: 9, fontWeight: 800, color: 'var(--mist)',
        textTransform: 'uppercase', letterSpacing: '.08em',
        marginBottom: 6,
      }}>{label}</div>
      {children}
    </div>
  )
}

function FlightDetails({ r }: { r: Reservation }) {
  const flightNum = r.details?.flight_number as string | undefined
  // Vendor + flight number on the same line: "Delta · DL425"
  const headerLine = [r.vendor, flightNum].filter(Boolean).join(' · ')
  const route = [r.details?.from, r.details?.to].filter(Boolean).join(' → ')
  return (
    <>
      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--green-dark)', lineHeight: 1.2 }}>
        {headerLine || 'Flight booked'}
      </div>
      {route && (
        <div style={{ fontSize: 11, color: 'var(--green-dark)', opacity: 0.7, marginTop: 2 }}>
          {route}
        </div>
      )}
      {r.departure_at && (
        <div style={{ fontSize: 11, color: 'var(--green-dark)', opacity: 0.7, marginTop: 4 }}>
          {fmtDayDate(r.departure_at)}<br />{fmtTime(r.departure_at)}
        </div>
      )}
    </>
  )
}

function HotelDetails({ r }: { r: Reservation }) {
  const nights = nightCount(r.check_in, r.check_out)
  return (
    <>
      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--green-dark)', lineHeight: 1.2 }}>
        {r.vendor || 'Hotel booked'}
      </div>
      {r.check_in && (
        <div style={{ fontSize: 11, color: 'var(--green-dark)', opacity: 0.7, marginTop: 4 }}>
          Check-in {new Date(r.check_in + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          {nights !== null && <><br />{nights} night{nights === 1 ? '' : 's'}</>}
        </div>
      )}
    </>
  )
}

function EmptyShell({ variant }: { variant: 'desktop' | 'mobile' }) {
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
        textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4,
      }}>Next event</div>
      <div style={{ fontSize: 14, color: 'var(--mist)' }}>
        No upcoming events scheduled.
      </div>
    </div>
  )
}
