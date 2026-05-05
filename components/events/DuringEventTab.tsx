'use client'

// During-Event tab inside BuyingEventsView. Renders one live card per
// event whose 3-day window contains today (multiple at once if the
// week has overlapping events). Surfaces the numbers a partner /
// admin checks while the event is running, and gives one-tap access
// to Day Entry for any day of the event.
//
// When nothing is live, shows an empty state pointing at the next
// scheduled event.

import { useMemo } from 'react'
import { useApp } from '@/lib/context'
import { eventEndIso, formatEventRange, isEventCurrent, EVENT_LENGTH_DAYS } from '@/lib/eventDates'
import { eventDisplayName } from '@/lib/eventName'
import { daySpend, dayCommission, eventSpend, eventCommission } from '@/lib/eventSpend'
import type { Event, EventDay } from '@/types'
import type { NavPage } from '@/app/page'
import WaitlistPanel from './WaitlistPanel'

interface Props {
  setNav?: (n: NavPage) => void
}

const fmtMoney = (n: number) =>
  '$' + Math.round(n).toLocaleString('en-US')

function todayIsoLocal(): string {
  const d = new Date(); d.setHours(0, 0, 0, 0)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Day index (1..EVENT_LENGTH_DAYS) for today within the event's 3-day window. */
function todayDayNumber(startIso: string): number | null {
  const today = new Date(todayIsoLocal() + 'T12:00:00').getTime()
  const start = new Date(startIso + 'T12:00:00').getTime()
  const idx = Math.round((today - start) / (24 * 60 * 60 * 1000)) + 1
  return idx >= 1 && idx <= EVENT_LENGTH_DAYS ? idx : null
}

export default function DuringEventTab({ setNav }: Props) {
  const { events, stores, user, setDayEntryIntent } = useApp()

  const live = useMemo(
    () => events.filter(e => e.status !== 'cancelled' && isEventCurrent(e)),
    [events]
  )

  const next = useMemo(() => {
    if (live.length > 0) return null
    const todayIso = todayIsoLocal()
    return events
      .filter(e => e.status !== 'cancelled' && !!e.start_date && eventEndIso(e.start_date!) >= todayIso)
      .sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''))[0] ?? null
  }, [events, live])

  function openDayEntry(ev: Event, day: number) {
    if (!setNav) return
    setDayEntryIntent({ eventId: ev.id, day, mode: 'buyer' })
    setNav('dayentry')
  }

  if (live.length === 0) {
    return (
      <div style={{
        background: '#fff', border: '1px solid var(--cream2)', borderRadius: 10,
        padding: 32, textAlign: 'center',
      }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>🌤️</div>
        <div style={{ fontWeight: 800, color: 'var(--ink)', marginBottom: 4 }}>
          No buying events live right now
        </div>
        <div style={{ fontSize: 13, color: 'var(--mist)' }}>
          {next
            ? <>Next up: <strong>{eventDisplayName(next, stores)}</strong> · {formatEventRange(next.start_date!)}</>
            : <>Nothing scheduled. Use Legacy view to add an event.</>}
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {live.map(ev => {
        const days = [...(ev.days || [])].sort((a, b) => a.day_number - b.day_number)
        const totalCustomers = days.reduce((s, d) => s + Number(d.customers || 0), 0)
        const totalPurchases = days.reduce((s, d) => s + Number(d.purchases || 0), 0)
        const totalSpend = eventSpend(ev)
        const totalCommission = eventCommission(ev)
        const closeRate = totalCustomers > 0 ? Math.round((totalPurchases / totalCustomers) * 100) : 0

        const todayN = todayDayNumber(ev.start_date!)
        const todayRow = todayN ? days.find(d => d.day_number === todayN) : null
        const tCust = Number(todayRow?.customers || 0)
        const tPurch = Number(todayRow?.purchases || 0)
        const tSpend = todayRow ? daySpend(todayRow) : 0
        const tClose = tCust > 0 ? Math.round((tPurch / tCust) * 100) : 0

        const store = stores.find(s => s.id === ev.store_id)
        const display = eventDisplayName(ev, stores)

        const canEdit =
          user?.role === 'admin' || user?.role === 'superadmin'
          || (ev.workers || []).some(w => w.id === user?.id)

        return (
          <div key={ev.id} style={{
            background: '#fff', border: '1px solid var(--cream2)',
            borderLeft: '4px solid #d4a017', borderRadius: 10, padding: '14px 16px',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>
                  <span style={{
                    display: 'inline-block', fontSize: 10, fontWeight: 800,
                    background: '#fff4d6', color: '#8a6d00', padding: '2px 6px', borderRadius: 4,
                    marginRight: 8, verticalAlign: 'middle',
                  }}>
                    🔴 LIVE · DAY {todayN ?? '–'} OF {EVENT_LENGTH_DAYS}
                  </span>
                  {display}
                </div>
                <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 2 }}>
                  {store?.city}{store?.state ? `, ${store.state}` : ''} · {formatEventRange(ev.start_date!)}
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--mist)' }}>
                {(ev.workers || []).filter(w => !(w as any).deleted).length} buyer{(ev.workers || []).length === 1 ? '' : 's'}
              </div>
            </div>

            {/* Today + running totals */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 14 }}>
              <Kpi label="Today's customers" value={String(tCust)} />
              <Kpi label="Today's purchases" value={String(tPurch)} />
              <Kpi label="Today's close" value={`${tClose}%`} />
              <Kpi label="Today's spend" value={fmtMoney(tSpend)} accent />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 14 }}>
              <Kpi label="Total customers" value={String(totalCustomers)} subdued />
              <Kpi label="Total purchases" value={String(totalPurchases)} subdued />
              <Kpi label="Overall close" value={`${closeRate}%`} subdued />
              <Kpi label="Total spend / commish" value={`${fmtMoney(totalSpend)} / ${fmtMoney(totalCommission)}`} subdued />
            </div>

            {/* Day breakdown + Day Entry shortcut */}
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${EVENT_LENGTH_DAYS}, 1fr)`, gap: 8 }}>
              {Array.from({ length: EVENT_LENGTH_DAYS }, (_, i) => i + 1).map(n => {
                const row = days.find(d => d.day_number === n)
                const isToday = n === todayN
                return (
                  <DayBox
                    key={n}
                    n={n}
                    row={row}
                    isToday={isToday}
                    canEdit={canEdit}
                    onOpen={() => openDayEntry(ev, n)}
                  />
                )
              })}
            </div>

            <WaitlistPanel ev={ev} />
          </div>
        )
      })}
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────

function Kpi({
  label, value, accent, subdued,
}: { label: string; value: string; accent?: boolean; subdued?: boolean }) {
  return (
    <div style={{
      background: subdued ? 'var(--cream2)' : '#fff',
      border: '1px solid var(--cream2)', borderRadius: 8, padding: '8px 10px',
    }}>
      <div style={{ fontSize: 10, color: 'var(--mist)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '.04em' }}>
        {label}
      </div>
      <div style={{
        fontSize: subdued ? 14 : 18, fontWeight: 800,
        color: accent ? 'var(--green-dark)' : 'var(--ink)', marginTop: 2,
      }}>
        {value}
      </div>
    </div>
  )
}

function DayBox({
  n, row, isToday, canEdit, onOpen,
}: { n: number; row?: EventDay; isToday: boolean; canEdit: boolean; onOpen: () => void }) {
  const cust = Number(row?.customers || 0)
  const purch = Number(row?.purchases || 0)
  const spend = row ? daySpend(row) : 0
  const hasData = cust + purch + spend > 0
  return (
    <button
      onClick={canEdit ? onOpen : undefined}
      disabled={!canEdit}
      style={{
        textAlign: 'left', cursor: canEdit ? 'pointer' : 'default',
        fontFamily: 'inherit',
        background: isToday ? '#fff8e1' : '#fff',
        border: `1px solid ${isToday ? '#ffd54f' : 'var(--cream2)'}`,
        borderRadius: 8, padding: '8px 10px',
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 700, color: isToday ? '#8a6d00' : 'var(--mist)', textTransform: 'uppercase' }}>
        Day {n}{isToday ? ' · Today' : ''}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginTop: 4 }}>
        {hasData ? `${cust} / ${purch} · ${fmtMoney(spend)}` : <span style={{ color: 'var(--mist)', fontWeight: 500 }}>No data</span>}
      </div>
      {canEdit && (
        <div style={{ fontSize: 10, color: 'var(--green-dark)', fontWeight: 700, marginTop: 4 }}>
          {hasData ? 'Edit →' : 'Enter day data →'}
        </div>
      )}
    </button>
  )
}
