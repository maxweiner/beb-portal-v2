'use client'

import { useEffect, useMemo, useState } from 'react'
import { buildSlotsForDay, hoursForEventDay } from '@/lib/appointments/slots'
import type { MockBookingPayload } from '@/lib/appointments/mockData'

type DayInfo = {
  dayNumber: 1 | 2 | 3
  dateStr: string
  hours: { start: string; end: string } | null
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

export default function BookingClient({ payload }: { payload: MockBookingPayload }) {
  const { store, config, events, override, bookings, blocks } = payload

  const primary = store.color_primary || '#1D6B44'
  const secondary = store.color_secondary || '#F5F0E8'

  const [selectedEventId, setSelectedEventId] = useState(events[0]?.id ?? '')
  const selectedEvent = events.find(e => e.id === selectedEventId) ?? events[0]

  // Compute per-day info for the selected event
  const dayInfos: DayInfo[] = useMemo(() => {
    if (!selectedEvent) return []
    return selectedEvent.days
      .map(d => {
        const dayNumber = d.day_number as 1 | 2 | 3
        const dateStr = addDays(selectedEvent.start_date, dayNumber - 1)
        const hours = hoursForEventDay(dayNumber, config, override)
        return { dayNumber, dateStr, hours }
      })
      .filter(di => {
        // Hide past days
        const today = new Date()
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
        return di.dateStr >= todayStr
      })
  }, [selectedEvent, config, override])

  const [selectedDay, setSelectedDay] = useState<DayInfo | null>(dayInfos[0] ?? null)
  // Reset day when the available days list changes (e.g. event switched)
  useEffect(() => {
    if (!dayInfos.find(di => di.dateStr === selectedDay?.dateStr)) {
      setSelectedDay(dayInfos[0] ?? null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayInfos])

  const slots = useMemo(() => {
    if (!selectedDay || !selectedDay.hours) return []
    return buildSlotsForDay({
      date: selectedDay.dateStr,
      startTime: selectedDay.hours.start,
      endTime: selectedDay.hours.end,
      intervalMinutes: config.slot_interval_minutes,
      maxConcurrent: override?.max_concurrent_slots ?? config.max_concurrent_slots,
      bookings,
      blocks,
    })
  }, [selectedDay, config, override, bookings, blocks])

  const [selectedTime, setSelectedTime] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [items, setItems] = useState<string[]>([])
  const [howHeard, setHowHeard] = useState('')
  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'done'>('idle')

  const canSubmit =
    selectedTime &&
    name.trim().length > 0 &&
    phone.trim().length > 0 &&
    email.trim().length > 0 &&
    items.length > 0 &&
    howHeard.length > 0

  function toggleItem(item: string) {
    setItems(prev => (prev.includes(item) ? prev.filter(i => i !== item) : [...prev, item]))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitState('submitting')
    // Mock-only: pretend the booking went through after a short delay
    setTimeout(() => setSubmitState('done'), 600)
  }

  if (submitState === 'done') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: secondary }}>
        <div className="bg-white rounded-2xl shadow-lg max-w-md w-full p-8 text-center">
          <h1 className="text-2xl font-bold mb-3" style={{ color: primary }}>You're booked!</h1>
          <p className="text-gray-700 mb-2">
            We'll see you on <strong>{selectedDay && formatDate(selectedDay.dateStr)}</strong> at{' '}
            <strong>{selectedTime && formatTime(selectedTime)}</strong>.
          </p>
          <p className="text-sm text-gray-500 mt-4">
            (Mock confirmation — no SMS or email is being sent yet.)
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen pb-12" style={{ background: secondary }}>
      {/* Header */}
      <header className="px-4 pt-8 pb-6 text-white" style={{ background: primary }}>
        <div className="max-w-md mx-auto">
          {store.store_image_url && (
            <img src={store.store_image_url} alt="" className="h-16 mb-3 rounded" />
          )}
          <h1 className="text-2xl font-bold">{store.name}</h1>
          {(store.owner_phone || store.owner_email) && (
            <p className="text-sm opacity-90 mt-1">
              {store.owner_phone}
              {store.owner_phone && store.owner_email ? ' · ' : ''}
              {store.owner_email}
            </p>
          )}
          <p className="text-base mt-3">Book your appointment</p>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 pt-6 space-y-6">
        {/* Event picker (if multiple) */}
        {events.length > 1 && (
          <section>
            <label className="block text-sm font-medium text-gray-700 mb-2">Select an event</label>
            <select
              className="w-full rounded-lg border border-gray-300 p-3 bg-white"
              value={selectedEventId}
              onChange={e => setSelectedEventId(e.target.value)}
            >
              {events.map(ev => (
                <option key={ev.id} value={ev.id}>
                  {formatDate(ev.start_date)}
                </option>
              ))}
            </select>
          </section>
        )}

        {/* Day picker */}
        {dayInfos.length > 0 ? (
          <section>
            <label className="block text-sm font-medium text-gray-700 mb-2">Pick a day</label>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {dayInfos.map(di => {
                const active = selectedDay?.dateStr === di.dateStr
                return (
                  <button
                    key={di.dateStr}
                    onClick={() => { setSelectedDay(di); setSelectedTime(null) }}
                    className="px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap border transition-colors"
                    style={
                      active
                        ? { background: primary, color: 'white', borderColor: primary }
                        : { background: 'white', color: '#374151', borderColor: '#d1d5db' }
                    }
                  >
                    Day {di.dayNumber} · {formatDate(di.dateStr)}
                  </button>
                )
              })}
            </div>
          </section>
        ) : (
          <section className="bg-white rounded-lg p-6 text-center text-gray-600">
            No upcoming days available.
          </section>
        )}

        {/* Slot grid */}
        {selectedDay && selectedDay.hours && (
          <section>
            <label className="block text-sm font-medium text-gray-700 mb-2">Pick a time</label>
            <div className="grid grid-cols-3 gap-2">
              {slots.map(s => {
                const disabled = s.isPast || s.blocked || s.available === 0
                const active = selectedTime === s.time
                return (
                  <button
                    key={s.time}
                    disabled={disabled}
                    onClick={() => setSelectedTime(s.time)}
                    className="p-3 rounded-lg text-sm font-medium border transition-colors text-center"
                    style={
                      active
                        ? { background: primary, color: 'white', borderColor: primary }
                        : disabled
                        ? { background: '#f3f4f6', color: '#9ca3af', borderColor: '#e5e7eb', cursor: 'not-allowed' }
                        : { background: 'white', color: '#111827', borderColor: '#d1d5db' }
                    }
                  >
                    <div>{formatTime(s.time)}</div>
                    {!disabled && s.available < s.capacity && (
                      <div className="text-[10px] opacity-70 mt-0.5">{s.available} left</div>
                    )}
                    {s.blocked && <div className="text-[10px] mt-0.5">blocked</div>}
                    {!s.blocked && s.available === 0 && !s.isPast && (
                      <div className="text-[10px] mt-0.5">full</div>
                    )}
                    {s.isPast && <div className="text-[10px] mt-0.5">past</div>}
                  </button>
                )
              })}
            </div>
            {slots.length === 0 && (
              <p className="text-gray-600 text-sm">No slots available for this day.</p>
            )}
          </section>
        )}

        {/* Booking form (only after slot selected) */}
        {selectedTime && (
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow p-5 space-y-4">
            <h2 className="font-semibold text-lg" style={{ color: primary }}>
              Your details
            </h2>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input
                type="text"
                required
                className="w-full rounded-lg border border-gray-300 p-3"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input
                type="tel"
                required
                className="w-full rounded-lg border border-gray-300 p-3"
                value={phone}
                onChange={e => setPhone(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                required
                className="w-full rounded-lg border border-gray-300 p-3"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                What are you bringing?
              </label>
              <div className="grid grid-cols-2 gap-2">
                {config.items_options.map(opt => {
                  const checked = items.includes(opt)
                  return (
                    <label
                      key={opt}
                      className="flex items-center gap-2 p-2 rounded-lg border text-sm cursor-pointer"
                      style={
                        checked
                          ? { borderColor: primary, background: primary + '14' }
                          : { borderColor: '#d1d5db' }
                      }
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleItem(opt)}
                        className="accent-current"
                        style={{ accentColor: primary }}
                      />
                      <span>{opt}</span>
                    </label>
                  )
                })}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                How did you hear about us?
              </label>
              <select
                required
                className="w-full rounded-lg border border-gray-300 p-3 bg-white"
                value={howHeard}
                onChange={e => setHowHeard(e.target.value)}
              >
                <option value="">Choose one…</option>
                {config.hear_about_options.map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              disabled={!canSubmit || submitState === 'submitting'}
              className="w-full rounded-lg p-3 text-white font-semibold disabled:opacity-50"
              style={{ background: primary }}
            >
              {submitState === 'submitting'
                ? 'Booking…'
                : `Book ${selectedDay && formatDate(selectedDay.dateStr)} at ${formatTime(selectedTime)}`}
            </button>
          </form>
        )}
      </main>
    </div>
  )
}
