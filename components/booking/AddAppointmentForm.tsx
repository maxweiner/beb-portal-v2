'use client'

// Unified appointment form used by both:
//   - Customer Booking URL & QR Codes  → /book/[slug]   (BookingClient)
//   - Store Portal Access              → /store-portal/[token]?add=1 (StorePortalClient)
//
// SOURCE OF TRUTH: Store Portal Access version. Layout, styling, day-picker
// (3-button grid), time-picker (<select> dropdown), field order, copy — all
// match the staff-portal modal verbatim.
//
// Staff-only fields (rendered only when mode === 'staff'):
//   - How heard            (chip grid, multi-select)
//   - Spiff to             (employee dropdown)
//   - Walk-in              (checkbox)
//
// Customer-only behaviour:
//   - Reschedule mode      (PUT to /api/appointments/:token instead of POST)
//   - QR attribution       (qr_code_id forwarded to API for spiff/lead-source)
//
// Event selection (which of a store's events to render) lives in the
// caller — both surfaces have their own event-picker logic that already
// works for in-flight events / multiple-events / sparse event_days.

import { useMemo, useState } from 'react'
import PhoneInput from '@/components/ui/PhoneInput'
import Checkbox from '@/components/ui/Checkbox'
import { buildSlotsForDay, hoursForEventDay } from '@/lib/appointments/slots'

export interface AddAppointmentFormStore {
  name: string
  city?: string | null
  state?: string | null
  color_primary?: string | null
}
export interface AddAppointmentFormEvent {
  id: string
  start_date: string
}
export interface AddAppointmentFormConfig {
  slot_interval_minutes: number
  max_concurrent_slots: number
  day1_start: string | null; day1_end: string | null
  day2_start: string | null; day2_end: string | null
  day3_start: string | null; day3_end: string | null
  hear_about_options: string[]
}
export interface AddAppointmentFormOverride {
  max_concurrent_slots?: number | null
  day1_start: string | null; day1_end: string | null
  day2_start: string | null; day2_end: string | null
  day3_start: string | null; day3_end: string | null
}
export interface AddAppointmentFormBooking {
  appointment_date: string
  appointment_time: string
  status: string
}
export interface AddAppointmentFormBlock {
  block_date: string
  block_time: string
}
export interface AddAppointmentFormEmployee {
  id: string; name: string
}

export interface AddAppointmentFormProps {
  mode: 'staff' | 'customer'
  store: AddAppointmentFormStore
  event: AddAppointmentFormEvent
  config: AddAppointmentFormConfig
  override: AddAppointmentFormOverride | null
  bookings: AddAppointmentFormBooking[]
  blocks: AddAppointmentFormBlock[]
  /** Required for the staff "Spiff to" dropdown. Customer mode ignores. */
  employees?: AddAppointmentFormEmployee[]
  /** Slug threaded into the API body so the server can resolve the store. */
  slug: string
  /** "store" for staff portal, "customer" for public page. */
  bookedBy: 'store' | 'customer'
  /** Customer-only: rescheduling an existing appointment via /api/appointments/:token PUT. */
  isReschedule?: boolean
  rescheduleToken?: string | null
  /** Customer-only: QR id for server-side spiff/lead-source attribution. */
  qrCodeId?: string | null
  /** Demo flow on /book/[slug]?mock — skip the API call. */
  isMock?: boolean
  /** Font-scale base (Store Portal modal). Defaults to 14 (medium). */
  basePx?: number
  /** Caller's success handler. Receives the chosen slot so the surface
   *  can render its own success state (modal close, full-page confirm, etc.). */
  onSuccess?: (info: { json: any; appointmentDate: string; appointmentTime: string }) => void
}

export default function AddAppointmentForm({
  mode, store, event, config, override, bookings, blocks,
  employees = [], slug, bookedBy,
  isReschedule = false, rescheduleToken = null,
  qrCodeId = null, isMock = false,
  basePx = 14, onSuccess,
}: AddAppointmentFormProps) {
  const primary = store.color_primary || '#1D6B44'
  const labelSize = '0.857em'
  const inputSize = '1em'
  const checkboxLabelSize = '0.929em'

  // Day picker — always emit all 3 day_numbers so the picker stays a
  // consistent 3-button row; days the event doesn't include (or already
  // past, or without hours) render disabled.
  const dayInfos = useMemo(() => {
    const today = todayIso()
    return [1, 2, 3].map(d => {
      const dayNumber = d as 1 | 2 | 3
      const dateStr = addDays(event.start_date, dayNumber - 1)
      const hours = hoursForEventDay(dayNumber, config, override || undefined)
      const enabled = !!hours && dateStr >= today
      return { dayNumber, dateStr, hours, enabled }
    })
  }, [event, config, override])

  const [formDate, setFormDate] = useState<string>('')
  const [formTime, setFormTime] = useState<string>('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [items, setItems] = useState('')
  const [howHeard, setHowHeard] = useState<string[]>([])
  const [empId, setEmpId] = useState<string>('')
  const [isWalkin, setIsWalkin] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const formDay = dayInfos.find(d => d.dateStr === formDate) ?? null

  const formSlots = useMemo(() => {
    if (!formDay || !formDay.hours) return []
    return buildSlotsForDay({
      date: formDay.dateStr,
      startTime: formDay.hours.start,
      endTime: formDay.hours.end,
      intervalMinutes: config.slot_interval_minutes,
      maxConcurrent: override?.max_concurrent_slots ?? config.max_concurrent_slots,
      bookings: bookings
        .filter(b => b.status === 'confirmed')
        .map(b => ({
          appointment_date: b.appointment_date,
          appointment_time: b.appointment_time,
          status: 'confirmed' as const,
        })),
      blocks,
    })
  }, [formDay, config, override, bookings, blocks])

  function toggleHowHeard(opt: string) {
    setHowHeard(prev => (prev.includes(opt) ? prev.filter(s => s !== opt) : [...prev, opt]))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!formDate) { setError('Please select a day.'); return }
    if (!formTime) { setError('Please select a time.'); return }
    if (!isReschedule && (!name.trim() || !phone.trim())) {
      setError('Customer name and phone are required.')
      return
    }
    setWorking(true); setError(null)

    if (isMock) {
      setWorking(false)
      onSuccess?.({ json: { ok: true, mock: true }, appointmentDate: formDate, appointmentTime: formTime })
      return
    }

    try {
      let res: Response
      if (isReschedule && rescheduleToken) {
        res = await fetch(`/api/appointments/${rescheduleToken}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appointment_date: formDate, appointment_time: formTime }),
        })
      } else {
        const itemsBringing = items.split(',').map(s => s.trim()).filter(Boolean)
        res = await fetch('/api/appointments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slug,
            event_id: event.id,
            appointment_date: formDate,
            appointment_time: formTime,
            customer_name: name.trim(),
            customer_phone: phone.trim(),
            customer_email: email.trim() || 'noemail@placeholder.local',
            items_bringing: itemsBringing.length ? itemsBringing : ['Not specified'],
            how_heard: mode === 'staff'
              ? (howHeard.length > 0 ? howHeard : ['The Store Told Me'])
              : ['Customer Booking'],
            ...(mode === 'staff' && {
              appointment_employee_id: empId || null,
              is_walkin: isWalkin,
            }),
            ...(qrCodeId ? { qr_code_id: qrCodeId } : {}),
            booked_by: bookedBy,
          }),
        })
      }
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error || `Could not save (${res.status})`)
      } else {
        onSuccess?.({ json, appointmentDate: formDate, appointmentTime: formTime })
      }
    } catch (err: any) {
      setError(err?.message || 'Network error')
    }
    setWorking(false)
  }

  return (
    <form onSubmit={handleSubmit} style={{ fontSize: `${basePx}px` }}>
      <div className="p-5 space-y-3">
        {/* Day picker — three buttons, no default */}
        <div>
          <label className="block font-semibold text-gray-700 mb-1" style={{ fontSize: labelSize }}>Day *</label>
          <div className="grid grid-cols-3 gap-2">
            {dayInfos.length === 0 ? (
              <div className="col-span-3 text-gray-500" style={{ fontSize: inputSize }}>No bookable days</div>
            ) : dayInfos.map(di => {
              const sel = di.dateStr === formDate
              return (
                <button
                  key={di.dayNumber}
                  type="button"
                  disabled={!di.enabled}
                  aria-pressed={sel}
                  onClick={() => { setFormDate(di.dateStr); setFormTime('') }}
                  style={{
                    padding: '0.6em 0.4em',
                    borderRadius: 8,
                    border: `1.5px solid ${primary}`,
                    background: sel ? primary : '#FFFFFF',
                    color: sel ? '#FFFFFF' : primary,
                    fontWeight: 700,
                    fontSize: '0.929em',
                    opacity: di.enabled ? 1 : 0.4,
                    cursor: di.enabled ? 'pointer' : 'not-allowed',
                    transition: 'background .15s ease, color .15s ease',
                    fontFamily: 'inherit',
                    lineHeight: 1.2,
                  }}
                >
                  {fmtDayButton(di.dateStr)}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <label className="block font-semibold text-gray-700 mb-1" style={{ fontSize: labelSize }}>Time</label>
          <select
            className="w-full rounded-lg border border-gray-300 p-2 bg-white"
            style={{ fontSize: inputSize }}
            value={formTime}
            onChange={e => setFormTime(e.target.value)}
            disabled={!formDate || formSlots.length === 0}
          >
            <option value="">— select —</option>
            {formSlots.map(s => {
              const isUnavailable = s.isPast || s.blocked || s.available === 0
              return (
                <option key={s.time} value={s.time} disabled={isUnavailable}>
                  {formatTime(s.time)} {isUnavailable ? '(full)' : `(${s.available} left)`}
                </option>
              )
            })}
          </select>
        </div>

        {!isReschedule && (
          <>
            <div>
              <label className="block font-semibold text-gray-700 mb-1" style={{ fontSize: labelSize }}>Customer name *</label>
              <input type="text" required value={name} onChange={e => setName(e.target.value)}
                style={{ fontSize: inputSize }}
                className="w-full rounded-lg border border-gray-300 p-2" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-gray-700 mb-1" style={{ fontSize: labelSize }}>Phone *</label>
                <PhoneInput required value={phone} onChange={v => setPhone(v)}
                  style={{ fontSize: inputSize }}
                  className="w-full rounded-lg border border-gray-300 p-2" />
              </div>
              <div>
                <label className="block font-semibold text-gray-700 mb-1" style={{ fontSize: labelSize }}>Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="(optional)"
                  style={{ fontSize: inputSize }}
                  className="w-full rounded-lg border border-gray-300 p-2" />
              </div>
            </div>
            <div>
              <label className="block font-semibold text-gray-700 mb-1" style={{ fontSize: labelSize }}>Bringing</label>
              <input type="text" value={items} onChange={e => setItems(e.target.value)}
                placeholder="Gold, Diamonds (comma separated)"
                style={{ fontSize: inputSize }}
                className="w-full rounded-lg border border-gray-300 p-2" />
            </div>

            {/* STAFF-ONLY: How heard, Spiff, Walk-in */}
            {mode === 'staff' && (
              <>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1" style={{ fontSize: labelSize }}>How heard (pick any)</label>
                  <div className="grid grid-cols-2 gap-2">
                    {config.hear_about_options.map(opt => {
                      const checked = howHeard.includes(opt)
                      return (
                        <label
                          key={opt}
                          className="flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors"
                          style={{
                            fontSize: checkboxLabelSize,
                            ...(checked
                              ? { borderColor: primary, background: primary + '14' }
                              : { borderColor: '#d1d5db' }),
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleHowHeard(opt)}
                            className="absolute opacity-0 w-0 h-0 pointer-events-none"
                          />
                          <span
                            aria-hidden="true"
                            className="flex items-center justify-center text-white font-black leading-none transition-colors shrink-0"
                            style={{
                              width: 20,
                              height: 20,
                              borderRadius: 5,
                              border: `2px solid ${checked ? primary : '#d1d5db'}`,
                              background: checked ? primary : '#FFFFFF',
                              fontSize: 13,
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
                  <label className="block font-semibold text-gray-700 mb-1" style={{ fontSize: labelSize }}>Spiff to</label>
                  <select value={empId} onChange={e => setEmpId(e.target.value)}
                    style={{ fontSize: inputSize }}
                    className="w-full rounded-lg border border-gray-300 p-2 bg-white">
                    <option value="">— none —</option>
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.name}</option>
                    ))}
                  </select>
                </div>

                <Checkbox
                  checked={isWalkin}
                  onChange={setIsWalkin}
                  label="Walk-in (customer is here in person now)"
                  labelStyle={{ fontSize: checkboxLabelSize, paddingTop: 4 }}
                />
              </>
            )}
          </>
        )}

        {error && (
          <div className="text-red-700 bg-red-50 border border-red-200 rounded-lg p-2"
            style={{ fontSize: inputSize }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={working}
          className="w-full rounded-lg p-3 text-white font-semibold disabled:opacity-50"
          style={{ background: primary, fontSize: inputSize }}
        >
          {working
            ? (isReschedule ? 'Rescheduling…' : 'Saving…')
            : (isReschedule ? 'Confirm reschedule' : 'Add appointment')}
        </button>
      </div>
    </form>
  )
}

// ─── Helpers (matching the Store Portal versions verbatim) ───

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatTime(hhmm: string): string {
  const t = hhmm.length >= 5 ? hhmm.slice(0, 5) : hhmm
  const [h, m] = t.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
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

function fmtDayButton(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  const wRaw = d.toLocaleDateString('en-US', { weekday: 'short' })
  const wMap: Record<string, string> = { Tue: 'Tues', Thu: 'Thurs' }
  const weekday = wMap[wRaw] || wRaw
  const month = d.toLocaleDateString('en-US', { month: 'short' })
  return `${weekday} ${month} ${ordinal(d.getDate())}`
}
