'use client'

// Unified appointment form used by both:
//   - public booking flow at /book/[slug] (BookingClient)
//   - staff portal "Add appointment" flow at /store-portal/[token]?add=1 (StorePortalClient)
//
// Layout matches the V1 mockup pick:
//   1. Day pills (3-col grid)  — same shape both surfaces had previously
//   2. Time grid (3-col coloured slots) — pulled from BookingClient's SlotGrid
//   3. Customer name
//   4. Phone + email (2-col)
//   5. Items bringing (checkbox grid when itemsOptions provided, else free-text)
//   6. How heard (checkbox grid, supports a locked option for QR pre-fill)
//   7. Spiff dropdown + Walk-in toggle (mode='portal' only)
//   8. Submit button
//
// The two callers retain their own banner / header / success state — the
// form itself just owns the body of the appointment-add flow so we don't
// duplicate field-by-field logic across surfaces.

import { useMemo, useState } from 'react'
import PhoneInput from '@/components/ui/PhoneInput'
import { buildSlotsForDay, hoursForEventDay } from '@/lib/appointments/slots'
import type { Slot } from '@/lib/appointments/types'

export interface AppointmentFormStore {
  name: string
  color_primary?: string | null
}
export interface AppointmentFormEvent {
  id: string
  start_date: string
  days?: { day_number: number }[]
}
export interface AppointmentFormConfig {
  slot_interval_minutes: number
  max_concurrent_slots: number
  day1_start: string | null; day1_end: string | null
  day2_start: string | null; day2_end: string | null
  day3_start: string | null; day3_end: string | null
  items_options?: string[]
  hear_about_options: string[]
}
export interface AppointmentFormOverride {
  max_concurrent_slots?: number | null
  day1_start: string | null; day1_end: string | null
  day2_start: string | null; day2_end: string | null
  day3_start: string | null; day3_end: string | null
}
export interface AppointmentFormBooking {
  appointment_date: string
  appointment_time: string
  status: string
}
export interface AppointmentFormBlock {
  block_date: string
  block_time: string
}
export interface AppointmentFormEmployee {
  id: string; name: string
}

export interface AppointmentFormProps {
  mode: 'public' | 'portal'
  store: AppointmentFormStore
  event: AppointmentFormEvent
  config: AppointmentFormConfig
  override: AppointmentFormOverride | null
  bookings: AppointmentFormBooking[]
  blocks: AppointmentFormBlock[]
  /** Required for the portal "spiff to" dropdown. Pass [] for public. */
  employees?: AppointmentFormEmployee[]
  /** Slug threaded into the API body so the server can resolve the store. */
  slug: string
  /** Pre-selected lockable lead source (typically from a QR pre-fill). */
  lockedHowHeard?: string | null
  /** QR id to attribute spiff/lead-source server-side. */
  qrCodeId?: string | null
  /** "customer" for public flow, "store" for portal. */
  bookedBy: 'customer' | 'store'
  /** True for the public ?reschedule=token flow — only date+time submit. */
  isReschedule?: boolean
  rescheduleToken?: string | null
  /** Fires after a successful submit. Receives the API json plus the
   * chosen date/time so callers can render their own success/confirmation
   * state without re-deriving them. */
  onSuccess?: (info: { json: any; appointmentDate: string; appointmentTime: string }) => void
  /** Demo flow on /book/[slug]?mock — skip the API call. */
  isMock?: boolean
}

const DEFAULT_ITEMS = ['Gold', 'Silver', 'Diamonds', 'Coins', 'Watches', 'Other']

export default function AppointmentForm({
  mode, store, event, config, override, bookings, blocks,
  employees = [], slug, lockedHowHeard = null, qrCodeId = null,
  bookedBy, isReschedule = false, rescheduleToken = null,
  onSuccess, isMock = false,
}: AppointmentFormProps) {
  const primary = store.color_primary || '#1D6B44'

  const today = todayIso()
  const dayInfos: DayInfo[] = useMemo(() => {
    const days = (event.days && event.days.length > 0)
      ? event.days
      : [{ day_number: 1 }, { day_number: 2 }, { day_number: 3 }]
    return days
      .map(d => {
        const dayNumber = d.day_number as 1 | 2 | 3
        const dateStr = addDays(event.start_date, dayNumber - 1)
        const hours = hoursForEventDay(dayNumber, config, override || undefined)
        // A day pill is enabled as long as it isn't in the past — same
        // rule as the old BookingClient. Days without configured hours
        // still let you click in; the time grid then renders the "No
        // slots configured for this day" empty state. This avoids the
        // form looking dead for stores that only configure hours for a
        // subset of day_numbers.
        const enabled = dateStr >= today
        return { dayNumber, dateStr, hours, enabled }
      })
  }, [event, config, override, today])

  // Default to the first day that's enabled AND has hours so the time
  // grid is immediately useful when there's a clear winner.
  const firstUsefulIdx = dayInfos.findIndex(d => d.enabled && !!d.hours)
  const firstEnabledIdx = dayInfos.findIndex(d => d.enabled)
  const [selectedDayIdx, setSelectedDayIdx] = useState<number | null>(
    firstUsefulIdx >= 0 ? firstUsefulIdx
      : firstEnabledIdx >= 0 ? firstEnabledIdx
      : null,
  )
  const selectedDay = selectedDayIdx !== null ? dayInfos[selectedDayIdx] : null

  const slots: Slot[] = useMemo(() => {
    if (!selectedDay?.hours) return []
    return buildSlotsForDay({
      date: selectedDay.dateStr,
      startTime: selectedDay.hours.start,
      endTime: selectedDay.hours.end,
      intervalMinutes: config.slot_interval_minutes,
      maxConcurrent: override?.max_concurrent_slots ?? config.max_concurrent_slots,
      bookings: bookings.filter(b => b.status === 'confirmed').map(b => ({
        appointment_date: b.appointment_date,
        appointment_time: b.appointment_time,
        status: 'confirmed' as const,
      })),
      blocks,
    })
  }, [selectedDay, config, override, bookings, blocks])

  const [selectedTime, setSelectedTime] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [items, setItems] = useState<string[]>([])
  const [itemsText, setItemsText] = useState('')
  const [howHeard, setHowHeard] = useState<string[]>(lockedHowHeard ? [lockedHowHeard] : [])
  const [empId, setEmpId] = useState<string>('')
  const [isWalkin, setIsWalkin] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Items: prefer the chip-style picker when the store has items_options
  // configured; fall back to a comma-separated text input.
  const itemsOptions = config.items_options && config.items_options.length > 0
    ? config.items_options
    : (mode === 'public' ? DEFAULT_ITEMS : [])

  const toggle = (arr: string[], v: string) => arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]

  const canSubmit = !!selectedDay && !!selectedTime && (
    isReschedule
      ? true
      : !!name.trim() && !!phone.trim()
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setError(null)
    setSubmitting(true)

    if (isMock) {
      setSubmitting(false)
      onSuccess?.({
        json: { ok: true, mock: true },
        appointmentDate: selectedDay!.dateStr,
        appointmentTime: selectedTime!,
      })
      return
    }

    try {
      let res: Response
      if (isReschedule && rescheduleToken) {
        res = await fetch(`/api/appointments/${rescheduleToken}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appointment_date: selectedDay!.dateStr,
            appointment_time: selectedTime,
          }),
        })
      } else {
        // Items: array if checkbox-mode picked anything, else parse
        // the free-text fallback on commas.
        const itemsBringing = itemsOptions.length > 0
          ? items
          : itemsText.split(',').map(s => s.trim()).filter(Boolean)
        res = await fetch('/api/appointments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slug,
            event_id: event.id,
            appointment_date: selectedDay!.dateStr,
            appointment_time: selectedTime,
            customer_name: name.trim(),
            customer_phone: phone.trim(),
            customer_email: email.trim() || 'noemail@placeholder.local',
            items_bringing: itemsBringing.length ? itemsBringing : ['Not specified'],
            how_heard: howHeard.length > 0 ? howHeard : ['The Store Told Me'],
            qr_code_id: qrCodeId ?? null,
            ...(mode === 'portal' ? {
              appointment_employee_id: empId || null,
              is_walkin: isWalkin,
              booked_by: bookedBy,
            } : {
              booked_by: bookedBy,
            }),
          }),
        })
      }
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error || `Could not save (${res.status})`)
      } else {
        onSuccess?.({
          json,
          appointmentDate: selectedDay!.dateStr,
          appointmentTime: selectedTime!,
        })
      }
    } catch (err: any) {
      setError(err?.message || 'Network error')
    }
    setSubmitting(false)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Day picker */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          {isReschedule ? 'Pick a new day' : 'Day'}{!isReschedule && <span style={{ color: primary }}> *</span>}
        </label>
        <div className="grid grid-cols-3 gap-2">
          {dayInfos.length === 0 ? (
            <div className="col-span-3 text-sm text-gray-500">No bookable days for this event.</div>
          ) : dayInfos.map((di, idx) => {
            const sel = selectedDayIdx === idx
            return (
              <button
                key={di.dateStr}
                type="button"
                disabled={!di.enabled}
                onClick={() => { setSelectedDayIdx(idx); setSelectedTime(null) }}
                className="relative rounded-lg border-2 transition-colors text-center"
                style={{
                  padding: '10px 6px',
                  borderColor: sel ? primary : (di.enabled ? '#d1d5db' : '#e5e7eb'),
                  background: sel ? primary : '#FFFFFF',
                  color: sel ? '#FFFFFF' : (di.enabled ? primary : '#9ca3af'),
                  fontWeight: 700, fontSize: 13, lineHeight: 1.15,
                  cursor: di.enabled ? 'pointer' : 'not-allowed',
                  opacity: di.enabled ? 1 : 0.5,
                  fontFamily: 'inherit',
                }}
              >
                <div style={{ fontSize: 11, opacity: .8, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                  {weekdayShort(di.dateStr)}
                </div>
                <div style={{ fontSize: 18, fontWeight: 900, marginTop: 2 }}>
                  {dayOfMonth(di.dateStr)}
                </div>
                <div style={{ fontSize: 10, opacity: .85, marginTop: 2 }}>
                  {monthShort(di.dateStr)}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Time grid */}
      {selectedDay && (
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Time<span style={{ color: primary }}> *</span>
          </label>
          {slots.length === 0 ? (
            <p className="text-sm text-gray-500">No slots configured for this day.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {slots.map(s => {
                const isUnavailable = s.isPast || s.blocked || s.available === 0
                const active = selectedTime === s.time
                const ratio = s.capacity > 0 ? s.available / s.capacity : 0
                let bg: string, fg: string, borderColor: string
                if (active) {
                  bg = '#fff'; fg = primary; borderColor = primary
                } else if (isUnavailable) {
                  bg = '#e5e7eb'; fg = '#9ca3af'; borderColor = '#e5e7eb'
                } else {
                  const alpha = 0.3 + 0.7 * ratio
                  bg = hexToRgba(primary, alpha)
                  fg = alpha > 0.55 ? '#fff' : '#1f2937'
                  borderColor = bg
                }
                return (
                  <button
                    key={s.time}
                    type="button"
                    disabled={isUnavailable}
                    onClick={() => setSelectedTime(s.time)}
                    className="relative p-3 rounded-lg text-sm font-semibold border transition-all text-center"
                    style={{
                      background: bg, color: fg, borderColor,
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
          )}
        </div>
      )}

      {/* Customer fields — skipped in reschedule mode since we don't change them */}
      {!isReschedule && (
        <>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Customer name<span style={{ color: primary }}> *</span>
            </label>
            <input type="text" required value={name} onChange={e => setName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 p-2.5 text-base bg-white" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Phone<span style={{ color: primary }}> *</span>
              </label>
              <PhoneInput required value={phone} onChange={v => setPhone(v)}
                className="w-full rounded-lg border border-gray-300 p-2.5 text-base bg-white" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="(optional)"
                className="w-full rounded-lg border border-gray-300 p-2.5 text-base bg-white" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              What are you bringing?
            </label>
            {itemsOptions.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {itemsOptions.map(opt => {
                  const checked = items.includes(opt)
                  return (
                    <CheckboxChip key={opt} label={opt} checked={checked} primary={primary}
                      onChange={() => setItems(p => toggle(p, opt))} />
                  )
                })}
              </div>
            ) : (
              <input type="text" value={itemsText} onChange={e => setItemsText(e.target.value)}
                placeholder="Gold, Diamonds (comma separated)"
                className="w-full rounded-lg border border-gray-300 p-2.5 text-base bg-white" />
            )}
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              How did you hear about us?
            </label>
            <div className="grid grid-cols-2 gap-2">
              {config.hear_about_options.map(opt => {
                const checked = howHeard.includes(opt)
                const isLocked = opt === lockedHowHeard
                return (
                  <CheckboxChip key={opt} label={opt} checked={checked} disabled={isLocked} primary={primary}
                    onChange={() => setHowHeard(p => toggle(p, opt))} />
                )
              })}
            </div>
          </div>

          {mode === 'portal' && (
            <>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Spiff to</label>
                <select value={empId} onChange={e => setEmpId(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 p-2.5 text-base bg-white">
                  <option value="">— none —</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.name}</option>
                  ))}
                </select>
              </div>
              <CheckboxChip
                label="Walk-in (customer is here in person now)"
                checked={isWalkin}
                primary={primary}
                onChange={() => setIsWalkin(v => !v)}
                fullRow
              />
            </>
          )}
        </>
      )}

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
          {error}
        </div>
      )}

      <button type="submit" disabled={!canSubmit || submitting}
        className="w-full rounded-lg p-3 text-white font-semibold disabled:opacity-50"
        style={{ background: primary }}>
        {submitting
          ? (isReschedule ? 'Rescheduling…' : 'Saving…')
          : (isReschedule ? 'Confirm reschedule' : 'Book appointment')}
      </button>
    </form>
  )
}

// ── Helpers (local copies — small enough that duplicating beats threading
// shared imports through every caller) ──

interface DayInfo {
  dayNumber: 1 | 2 | 3
  dateStr: string
  hours: { start: string; end: string } | null
  enabled: boolean
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function weekdayShort(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })
}
function dayOfMonth(iso: string): number {
  return new Date(iso + 'T12:00:00').getDate()
}
function monthShort(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short' })
}
function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// ── Inline checkbox-chip component (visible square + hidden input) ──

function CheckboxChip({ label, checked, primary, onChange, disabled = false, fullRow = false }: {
  label: string
  checked: boolean
  primary: string
  onChange: () => void
  disabled?: boolean
  fullRow?: boolean
}) {
  return (
    <label
      className={`flex items-center gap-2 p-2 rounded-lg border text-sm transition-colors ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'} ${fullRow ? 'col-span-2' : ''}`}
      style={
        checked
          ? { borderColor: primary, background: primary + '14' }
          : { borderColor: '#d1d5db' }
      }>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="absolute opacity-0 w-0 h-0 pointer-events-none"
      />
      <span aria-hidden="true"
        className="flex items-center justify-center text-white font-black leading-none transition-colors shrink-0"
        style={{
          width: 22, height: 22, borderRadius: 5,
          border: `2px solid ${checked ? primary : '#d1d5db'}`,
          background: checked ? primary : '#FFFFFF',
          fontSize: 14, opacity: disabled ? 0.7 : 1,
        }}>
        {checked ? '✓' : ''}
      </span>
      <span>{label}</span>
    </label>
  )
}
