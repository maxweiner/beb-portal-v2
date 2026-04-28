'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Diamond } from 'lucide-react'
import { buildSlotsForDay, hoursForEventDay } from '@/lib/appointments/slots'
import type { MockBookingPayload } from '@/lib/appointments/mockData'
import type { Slot } from '@/lib/appointments/types'
import PhoneInput from '@/components/ui/PhoneInput'
import { formatPhoneDisplay } from '@/lib/phone'
import AddAppointmentForm from '@/components/booking/AddAppointmentForm'

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

  // Prefer the soonest event that has at least one *bookable* day —
  // date >= today AND hours configured. The server now includes in-flight
  // events (start_date >= today − 2), so events[0] sorted oldest-first
  // might be a today-ending event whose only future day_number lacks
  // hours, leaving an accordion the customer can expand only to read
  // "no slots configured". Match StorePortalClient's selection rule so
  // the public page and the staff-portal page never disagree on which
  // event of a store is "the bookable one".
  const today = todayIso()
  // Always consider all three day_numbers, not just the rows that happen
  // to exist on event_days. getBookingPayload only synthesises default
  // day rows when event_days is COMPLETELY empty — if a single row exists
  // (e.g. day 1 was entered but 2 and 3 weren't), the other day_numbers
  // would otherwise drop out of the picker entirely. Same approach
  // StorePortalClient uses.
  const computeDays = (e: typeof events[number]): DayInfo[] =>
    [1, 2, 3]
      .map(n => {
        const dayNumber = n as 1 | 2 | 3
        const dateStr = addDays(e.start_date, dayNumber - 1)
        const hours = hoursForEventDay(dayNumber, config, override)
        return { dayNumber, dateStr, hours }
      })
      .filter(di => di.dateStr >= today)
  const { event, dayInfos } = useMemo(() => {
    for (const candidate of events) {
      const di = computeDays(candidate)
      if (di.some(d => !!d.hours)) return { event: candidate, dayInfos: di }
    }
    // Fall through: no event has both a future day AND hours. Try any event
    // with a future day, then events[0] as a last resort, so the empty-state
    // message still renders rather than crashing on undefined.
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
  // Captured by AddAppointmentForm.onSuccess so the success page can show
  // exactly what was just booked.
  const [bookedDate, setBookedDate] = useState<string | null>(null)
  const [bookedTime, setBookedTime] = useState<string | null>(null)

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
              We'll see you on <strong>{bookedDate && formatDateLong(bookedDate)}</strong> at{' '}
              <strong>{bookedTime && formatTime(bookedTime)}</strong>.
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
      {/* Branded header — matches the StorePortal pattern (white bg, 4px
          primary border, store name in primary, owner contact, store image
          on the right). Same shape as the success state below. */}
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
              <div className="h-28 w-28 rounded-xl flex items-center justify-center" style={{ background: '#f3f4f6', color: primary }}>
                <Diamond className="h-12 w-12" strokeWidth={1.5} />
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

        {/* White card around the form so the cream page bg doesn't bleed
            through and make the cream-bg input fields look transparent.
            Mirrors the staff modal's white interior box. */}
        <div className="bg-white rounded-2xl shadow overflow-hidden">
          <AddAppointmentForm
            mode="customer"
            store={store}
            event={event}
            config={config}
            override={override ?? null}
            bookings={bookings}
            blocks={blocks}
            slug={slug}
            bookedBy="customer"
            isReschedule={isReschedule}
            rescheduleToken={isReschedule ? rescheduling!.token : null}
            qrCodeId={qrAttribution?.qr_code_id ?? null}
            isMock={isMock}
            onSuccess={({ appointmentDate, appointmentTime }) => {
              setBookedDate(appointmentDate)
              setBookedTime(appointmentTime)
              setSubmitState('done')
            }}
          />
        </div>

        {isReschedule && (
          <a
            href={`/book/manage/${rescheduling!.token}`}
            className="block text-center text-sm underline"
            style={{ color: primary }}
          >
            Cancel reschedule (keep current time)
          </a>
        )}
      </main>
    </div>
  )
}
