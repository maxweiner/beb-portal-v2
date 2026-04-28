'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Diamond } from 'lucide-react'
import { buildSlotsForDay, hoursForEventDay } from '@/lib/appointments/slots'
import type { MockBookingPayload } from '@/lib/appointments/mockData'
import type { Slot } from '@/lib/appointments/types'
import PhoneInput from '@/components/ui/PhoneInput'
import { formatPhoneDisplay } from '@/lib/phone'

// ---------- helpers ----------

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

function ordinal(n: number): string {
  const v = n % 100
  if (v >= 11 && v <= 13) return `${n}th`
  switch (n % 10) {
    case 1: return `${n}st`
    case 2: return `${n}nd`
    case 3: return `${n}rd`
    default: return `${n}th`
  }
}

function formatDateLong(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  const weekday = d.toLocaleDateString(undefined, { weekday: 'long' })
  const month = d.toLocaleDateString(undefined, { month: 'long' })
  return `${weekday}, ${month} ${ordinal(d.getDate())}`
}

function formatDateShort(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ---------- shared sub-components ----------

function SlotGrid({
  slots,
  primary,
  selectedTime,
  onSelect,
}: {
  slots: Slot[]
  primary: string
  selectedTime: string | null
  onSelect: (time: string) => void
}) {
  if (slots.length === 0) {
    return <p className="text-sm text-gray-500">No slots configured for this day.</p>
  }
  return (
    <div className="grid grid-cols-3 gap-2">
      {slots.map(s => {
        const isUnavailable = s.isPast || s.blocked || s.available === 0
        const active = selectedTime === s.time
        const ratio = s.capacity > 0 ? s.available / s.capacity : 0

        let bg: string, fg: string, borderColor: string
        if (active) {
          bg = 'white'; fg = primary; borderColor = primary
        } else if (isUnavailable) {
          bg = '#e5e7eb'; fg = '#9ca3af'; borderColor = '#e5e7eb'
        } else {
          const alpha = 0.3 + 0.7 * ratio
          bg = hexToRgba(primary, alpha)
          fg = alpha > 0.55 ? 'white' : '#1f2937'
          borderColor = bg
        }

        return (
          <button
            key={s.time}
            disabled={isUnavailable}
            onClick={() => onSelect(s.time)}
            className="relative p-3 rounded-lg text-sm font-semibold border transition-all text-center"
            style={{
              background: bg,
              color: fg,
              borderColor,
              borderWidth: active ? 2 : 1,
              cursor: isUnavailable ? 'not-allowed' : 'pointer',
            }}
          >
            {!isUnavailable && (
              <span className="absolute top-1 right-1.5 text-[10px] font-bold leading-none">
                {s.available}
              </span>
            )}
            <span className={s.isPast ? 'line-through' : ''}>{formatTime(s.time)}</span>
            {s.blocked && <div className="text-[10px] mt-0.5">blocked</div>}
          </button>
        )
      })}
    </div>
  )
}

function AccordionDayBody({
  day,
  primary,
  config,
  override,
  bookings,
  blocks,
  selectedTime,
  onSelect,
}: {
  day: DayInfo
  primary: string
  config: MockBookingPayload['config']
  override: MockBookingPayload['override']
  bookings: MockBookingPayload['bookings']
  blocks: MockBookingPayload['blocks']
  selectedTime: string | null
  onSelect: (t: string) => void
}) {
  const slots = useMemo(() => {
    if (!day.hours) return []
    return buildSlotsForDay({
      date: day.dateStr,
      startTime: day.hours.start,
      endTime: day.hours.end,
      intervalMinutes: config.slot_interval_minutes,
      maxConcurrent: override?.max_concurrent_slots ?? config.max_concurrent_slots,
      bookings,
      blocks,
    })
  }, [day, config, override, bookings, blocks])

  return (
    <div className="p-3 bg-gray-50">
      <SlotGrid slots={slots} primary={primary} selectedTime={selectedTime} onSelect={onSelect} />
    </div>
  )
}

// ---------- top-level page ----------

interface RescheduleContext {
  token: string
  customer_name: string
  current_date: string
  current_time: string
}

interface QrAttribution {
  qr_code_id: string
  pre_fill_how_heard: string | null
}

export default function BookingClient({
  slug,
  payload,
  isMock,
  rescheduling,
  qrAttribution,
}: {
  slug: string
  payload: MockBookingPayload
  isMock: boolean
  rescheduling?: RescheduleContext | null
  qrAttribution?: QrAttribution | null
}) {
  const { store, config, events, override, bookings, blocks } = payload
  const primary = store.color_primary || '#1D6B44'
  const secondary = store.color_secondary || '#F5F0E8'
  const isReschedule = !!rescheduling

  // Prefer the soonest event with at least one bookable day. The server
  // now includes in-flight events (start_date >= today − 2), which means
  // events[0] sorted oldest-first might be a today-ending or sparsely-
  // populated event whose days all filter out. Fall through to the next
  // event so customers don't land on an empty picker.
  const today = todayIso()
  const computeDays = (e: typeof events[number]): DayInfo[] =>
    e.days
      .map(d => {
        const dayNumber = d.day_number as 1 | 2 | 3
        const dateStr = addDays(e.start_date, dayNumber - 1)
        const hours = hoursForEventDay(dayNumber, config, override)
        return { dayNumber, dateStr, hours }
      })
      .filter(di => di.dateStr >= today)
  const { event, dayInfos } = useMemo(() => {
    for (const candidate of events) {
      const di = computeDays(candidate)
      if (di.length > 0) return { event: candidate, dayInfos: di }
    }
    return { event: events[0], dayInfos: [] as DayInfo[] }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, config, override, today])

  const [openIdx, setOpenIdx] = useState(0)
  const [selectedDayIdx, setSelectedDayIdx] = useState<number | null>(null)
  const [selectedTime, setSelectedTime] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [items, setItems] = useState<string[]>([])
  // Pre-fill how_heard from QR (channel / custom). Employee QRs leave it blank.
  // Multi-select: array of selected sources. The pre-filled QR source is locked.
  const lockedSource = qrAttribution?.pre_fill_how_heard ?? null
  const [howHeard, setHowHeard] = useState<string[]>(
    lockedSource ? [lockedSource] : []
  )
  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'done'>('idle')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(12)

  // Auto-redirect back to the booking screen 12 seconds after a successful
  // booking or reschedule, with a live countdown.
  useEffect(() => {
    if (submitState !== 'done') return
    setSecondsLeft(12)
    const tick = setInterval(() => {
      setSecondsLeft(s => Math.max(0, s - 1))
    }, 1000)
    const redirect = setTimeout(() => {
      window.location.href = `/book/${slug}`
    }, 12000)
    return () => { clearInterval(tick); clearTimeout(redirect) }
  }, [submitState, slug])

  const selectedDay = selectedDayIdx !== null ? dayInfos[selectedDayIdx] : null
  const canSubmit = isReschedule
    ? !!(selectedDay && selectedTime)
    : !!(
        selectedDay &&
        selectedTime &&
        name.trim().length > 0 &&
        phone.trim().length > 0 &&
        email.trim().length > 0 &&
        items.length > 0 &&
        howHeard.length > 0
      )

  function toggleHowHeard(opt: string) {
    if (opt === lockedSource) return // can't unlock the QR-derived source
    setHowHeard(prev => (prev.includes(opt) ? prev.filter(s => s !== opt) : [...prev, opt]))
  }

  // Auto-scroll to the booking form the first time the customer picks a slot.
  // Tracked via a ref so picking a different time doesn't re-scroll the page
  // (would be jumpy if they're shopping around for a different slot).
  const formRef = useRef<HTMLFormElement | null>(null)
  const prevSelectedTimeRef = useRef<string | null>(selectedTime)
  useEffect(() => {
    if (prevSelectedTimeRef.current === null && selectedTime !== null) {
      // requestAnimationFrame so the form is mounted before we scroll to it.
      requestAnimationFrame(() => {
        formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }
    prevSelectedTimeRef.current = selectedTime
  }, [selectedTime])

  function toggleItem(item: string) {
    setItems(prev => (prev.includes(item) ? prev.filter(i => i !== item) : [...prev, item]))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitState('submitting')
    setSubmitError(null)

    if (isMock) {
      // Demo slug — never hit the API, just show the mock confirmation.
      setTimeout(() => setSubmitState('done'), 600)
      return
    }

    try {
      const res = isReschedule
        ? await fetch(`/api/appointments/${rescheduling!.token}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              appointment_date: selectedDay!.dateStr,
              appointment_time: selectedTime,
            }),
          })
        : await fetch('/api/appointments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              slug,
              event_id: event.id,
              appointment_date: selectedDay!.dateStr,
              appointment_time: selectedTime,
              customer_name: name,
              customer_phone: phone,
              customer_email: email,
              items_bringing: items,
              how_heard: howHeard,
              qr_code_id: qrAttribution?.qr_code_id ?? null,
            }),
          })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSubmitState('idle')
        setSubmitError(json.error || `Booking failed (${res.status})`)
        return
      }
      setSubmitState('done')
    } catch (err: any) {
      setSubmitState('idle')
      setSubmitError(err?.message || 'Network error — please try again.')
    }
  }

  if (submitState === 'done') {
    return (
      <div className="min-h-screen pb-12" style={{ background: secondary }}>
        {/* Branded header — same shape as the booking page */}
        <header className="px-4 pb-6 bg-white" style={{
          borderBottom: `4px solid ${primary}`,
          paddingTop: 'max(env(safe-area-inset-top), 32px)',
        }}>
          <div className="max-w-md mx-auto flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-extrabold leading-tight" style={{ color: primary }}>{store.name}</h1>
              {(store.owner_phone || store.owner_email) && (
                <div className="text-sm text-gray-700 mt-1 leading-snug">
                  {store.owner_phone && <div>{formatPhoneDisplay(store.owner_phone)}</div>}
                  {store.owner_email && <div className="break-all">{store.owner_email}</div>}
                </div>
              )}
            </div>
            <div className="shrink-0">
              {store.store_image_url ? (
                <img
                  src={store.store_image_url}
                  alt={`${store.name} logo`}
                  className="h-28 w-28 rounded-xl object-cover"
                />
              ) : (
                <div
                  className="h-28 w-28 rounded-xl flex items-center justify-center"
                  style={{ background: '#f3f4f6', color: primary }}
                >
                  <Diamond className="h-12 w-12" strokeWidth={1.5} />
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="max-w-md mx-auto px-4 pt-10">
          <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
            <h2 className="text-2xl font-bold mb-3" style={{ color: primary }}>
              {isReschedule ? 'Rescheduled!' : "You're booked!"}
            </h2>
            <p className="text-gray-700 mb-2">
              We'll see you on <strong>{selectedDay && formatDateLong(selectedDay.dateStr)}</strong> at{' '}
              <strong>{selectedTime && formatTime(selectedTime)}</strong>.
            </p>
            <p className="text-sm text-gray-500 mt-4">
              {isMock
                ? '(Mock confirmation — this is the demo store, no real booking was saved.)'
                : 'A confirmation will be sent shortly.'}
            </p>
            <a
              href={`/book/${slug}`}
              className="block mt-6 w-full rounded-lg p-3 text-white font-semibold"
              style={{ background: primary }}
            >
              Return to Bookings
            </a>
            {isReschedule && (
              <a
                href={`/book/manage/${rescheduling!.token}`}
                className="block mt-3 text-sm underline"
                style={{ color: primary }}
              >
                View your appointment
              </a>
            )}
            <p className="text-xs text-gray-400 mt-4">
              Returning to bookings in {secondsLeft} second{secondsLeft === 1 ? '' : 's'}…
            </p>
          </div>
        </main>
      </div>
    )
  }

  if (dayInfos.length === 0) {
    return (
      <div className="min-h-screen p-8 text-center text-gray-600" style={{ background: secondary }}>
        No upcoming days available.
      </div>
    )
  }

  return (
    <div className="min-h-screen pb-12" style={{ background: secondary }}>
      {/* Header */}
      <header className="px-4 pt-8 pb-6 text-white" style={{ background: primary }}>
        <div className="max-w-md mx-auto flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold leading-tight">{store.name}</h1>
            {(store.owner_phone || store.owner_email) && (
              <div className="text-sm opacity-90 mt-2 space-y-1 leading-tight">
                {store.owner_phone && <div>{formatPhoneDisplay(store.owner_phone)}</div>}
                {store.owner_email && <div className="break-all">{store.owner_email}</div>}
              </div>
            )}
            <p className="text-sm mt-2 text-gray-500">
              {isReschedule ? 'Reschedule your appointment' : 'Book your appointment'}
            </p>
          </div>
          <div className="shrink-0">
            {store.store_image_url ? (
              <img
                src={store.store_image_url}
                alt={`${store.name} logo`}
                className="h-20 w-20 rounded-xl object-cover shadow-md ring-1 ring-white/20"
              />
            ) : (
              <div className="h-20 w-20 rounded-xl bg-white/10 flex items-center justify-center ring-1 ring-white/20">
                <Diamond className="h-10 w-10" strokeWidth={1.5} />
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 pt-6 space-y-6">
        {isReschedule && (
          <div
            className="rounded-xl px-4 py-3 text-sm border-2"
            style={{ background: '#FEF3C7', borderColor: '#F59E0B', color: '#78350F' }}
          >
            <div className="font-bold mb-1">Rescheduling for {rescheduling!.customer_name}</div>
            <div>
              Currently booked: {formatDateLong(rescheduling!.current_date)} at{' '}
              {formatTime(rescheduling!.current_time.length >= 5 ? rescheduling!.current_time.slice(0, 5) : rescheduling!.current_time)}
            </div>
            <div className="mt-1 opacity-80">Pick a new time below.</div>
          </div>
        )}

        {/* Accordion day picker */}
        <section>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {isReschedule ? 'Pick a new day and time' : 'Pick a day and time'}
          </label>
          <div className="space-y-2">
            {dayInfos.map((di, idx) => {
              const isOpen = idx === openIdx
              return (
                <div
                  key={di.dateStr}
                  className={`border-2 rounded-xl overflow-hidden bg-white transition-colors ${
                    isOpen ? 'border-yellow-400' : 'border-gray-200'
                  }`}
                >
                  <button
                    onClick={() => setOpenIdx(isOpen ? -1 : idx)}
                    className="w-full flex items-center justify-between px-4 py-3 transition-colors"
                    style={
                      isOpen
                        ? { background: primary + '14', color: primary }
                        : { background: 'white', color: '#1f2937' }
                    }
                  >
                    <div className="text-left">
                      <div className="text-xs font-semibold uppercase tracking-wide opacity-70">
                        Day {di.dayNumber}
                      </div>
                      <div className="text-base font-bold mt-0.5">{formatDateLong(di.dateStr)}</div>
                    </div>
                    {isOpen
                      ? <ChevronDown className="w-5 h-5" />
                      : <ChevronRight className="w-5 h-5" />}
                  </button>
                  {isOpen && (
                    <AccordionDayBody
                      day={di}
                      primary={primary}
                      config={config}
                      override={override}
                      bookings={bookings}
                      blocks={blocks}
                      selectedTime={selectedDayIdx === idx ? selectedTime : null}
                      onSelect={t => { setSelectedTime(t); setSelectedDayIdx(idx) }}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {/* Reschedule confirm card */}
        {isReschedule && selectedDay && selectedTime && (
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow p-5 space-y-3">
            <h2 className="font-semibold text-lg" style={{ color: primary }}>
              Confirm new time
            </h2>
            <p className="text-sm text-gray-700">
              <strong>{formatDateLong(selectedDay.dateStr)}</strong> at{' '}
              <strong>{formatTime(selectedTime)}</strong>
            </p>
            {submitError && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                {submitError}
              </div>
            )}
            <button
              type="submit"
              disabled={!canSubmit || submitState === 'submitting'}
              className="w-full rounded-lg p-3 text-white font-semibold disabled:opacity-50"
              style={{ background: primary }}
            >
              {submitState === 'submitting' ? 'Rescheduling…' : 'Confirm reschedule'}
            </button>
            <a
              href={`/book/manage/${rescheduling!.token}`}
              className="block text-center text-sm underline"
              style={{ color: primary }}
            >
              Cancel reschedule (keep current time)
            </a>
          </form>
        )}

        {/* Booking form (only after slot selected, and not in reschedule mode) */}
        {!isReschedule && selectedDay && selectedTime && (
          <form ref={formRef} onSubmit={handleSubmit} className="bg-white rounded-2xl shadow p-5 space-y-4 scroll-mt-4">
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
              <PhoneInput
                required
                className="w-full rounded-lg border border-gray-300 p-3"
                value={phone}
                onChange={v => setPhone(v)}
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
                      className="flex items-center gap-2 p-2 rounded-lg border text-sm cursor-pointer transition-colors"
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
                        className="absolute opacity-0 w-0 h-0 pointer-events-none"
                      />
                      <span
                        aria-hidden="true"
                        className="flex items-center justify-center text-white font-black leading-none transition-colors shrink-0"
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 5,
                          border: `2px solid ${checked ? primary : '#d1d5db'}`,
                          background: checked ? primary : '#FFFFFF',
                          fontSize: 14,
                        }}
                      >
                        {checked ? '✓' : ''}
                      </span>
                      <span>{opt}</span>
                    </label>
                  )
                })}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                How did you hear about us?
              </label>
              <div className="grid grid-cols-2 gap-2">
                {config.hear_about_options.map(opt => {
                  const checked = howHeard.includes(opt)
                  const isLocked = opt === lockedSource
                  return (
                    <label
                      key={opt}
                      className={`flex items-center gap-2 p-2 rounded-lg border text-sm transition-colors ${
                        isLocked ? 'cursor-not-allowed' : 'cursor-pointer'
                      }`}
                      style={
                        checked
                          ? { borderColor: primary, background: primary + '14' }
                          : { borderColor: '#d1d5db' }
                      }
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={isLocked}
                        onChange={() => toggleHowHeard(opt)}
                        className="absolute opacity-0 w-0 h-0 pointer-events-none"
                      />
                      <span
                        aria-hidden="true"
                        className="flex items-center justify-center text-white font-black leading-none transition-colors shrink-0"
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 5,
                          border: `2px solid ${checked ? primary : '#d1d5db'}`,
                          background: checked ? primary : '#FFFFFF',
                          fontSize: 14,
                          opacity: isLocked ? 0.7 : 1,
                        }}
                      >
                        {checked ? '✓' : ''}
                      </span>
                      <span style={isLocked ? { color: '#6b7280' } : undefined}>
                        {opt}
                        {isLocked && <span className="ml-1 text-[10px] uppercase tracking-wide font-bold">locked</span>}
                      </span>
                    </label>
                  )
                })}
              </div>
              {lockedSource && (
                <p className="text-[11px] text-gray-500 mt-2">
                  We pre-selected the source you came from — you can add more if applicable.
                </p>
              )}
            </div>

            {submitError && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                {submitError}
              </div>
            )}
            <button
              type="submit"
              disabled={!canSubmit || submitState === 'submitting'}
              className="w-full rounded-lg p-3 text-white font-semibold disabled:opacity-50"
              style={{ background: primary }}
            >
              {submitState === 'submitting'
                ? 'Booking…'
                : `Book ${formatDateShort(selectedDay.dateStr)} at ${formatTime(selectedTime)}`}
            </button>
          </form>
        )}
      </main>
    </div>
  )
}
