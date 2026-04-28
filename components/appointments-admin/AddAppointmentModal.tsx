'use client'

import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Store, Event } from '@/types'
import { buildSlotsForDay, hoursForEventDay } from '@/lib/appointments/slots'
import PhoneInput from '@/components/ui/PhoneInput'
import Checkbox from '@/components/ui/Checkbox'

interface BookingConfig {
  slot_interval_minutes: number
  max_concurrent_slots: number
  day1_start: string | null; day1_end: string | null
  day2_start: string | null; day2_end: string | null
  day3_start: string | null; day3_end: string | null
  items_options: string[]
  hear_about_options: string[]
}

interface EmployeeRow { id: string; name: string }

const DEFAULT_ITEMS = ['Gold', 'Diamonds', 'Watches', 'Coins', 'Jewelry', "I'm Not Sure"]
const DEFAULT_HEAR = ['Large Postcard', 'Small Postcard', 'Newspaper', 'Email', 'Text', 'The Store Told Me']

type FontScale = 'sm' | 'md' | 'lg'
const FONT_SCALE_KEY = 'addApptFontScale'
const SCALE_MULTIPLIER: Record<FontScale, number> = { sm: 1, md: 1.15, lg: 1.3 }
const SCALE_LABEL: Record<FontScale, string> = { sm: 'Small', md: 'Medium', lg: 'Large' }

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function fmtTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}
function fmtDateLong(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
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
  const wRaw = d.toLocaleDateString('en-US', { weekday: 'short' }) // "Mon" "Tue" "Wed" "Thu" ...
  const wMap: Record<string, string> = { Tue: 'Tues', Thu: 'Thurs' }
  const weekday = wMap[wRaw] || wRaw
  const month = d.toLocaleDateString('en-US', { month: 'short' })
  return `${weekday} ${month} ${ordinal(d.getDate())}`
}

export default function AddAppointmentModal({
  stores,
  events,
  onClose,
  onCreated,
}: {
  stores: Store[]
  events: Event[]
  onClose: () => void
  onCreated: () => void
}) {
  // Stores must have a slug to receive a booking — POST /api/appointments
  // requires the slug.
  const slugStores = useMemo(() => stores.filter(s => !!s.slug), [stores])

  const [storeId, setStoreId] = useState<string>(slugStores[0]?.id || '')
  const store = useMemo(() => slugStores.find(s => s.id === storeId), [slugStores, storeId])

  // Upcoming events for the selected store
  const today = todayIso()
  const storeEvents = useMemo(() =>
    events.filter(e => e.store_id === storeId && e.start_date >= today)
          .sort((a, b) => a.start_date.localeCompare(b.start_date))
  , [events, storeId, today])
  const [eventId, setEventId] = useState<string>('')
  useEffect(() => { setEventId(storeEvents[0]?.id || '') }, [storeEvents])
  const event = storeEvents.find(e => e.id === eventId)

  // Per-store config + employees for the spiff dropdown
  const [config, setConfig] = useState<BookingConfig | null>(null)
  const [employees, setEmployees] = useState<EmployeeRow[]>([])
  useEffect(() => {
    if (!storeId) { setConfig(null); setEmployees([]); return }
    let cancelled = false
    Promise.all([
      supabase.from('booking_config').select('*').eq('store_id', storeId).maybeSingle(),
      supabase.from('store_employees').select('id, name').eq('store_id', storeId).eq('active', true).order('name'),
    ]).then(([cfgRes, empRes]) => {
      if (cancelled) return
      setConfig(cfgRes.data ?? null)
      setEmployees((empRes.data || []) as EmployeeRow[])
    })
    return () => { cancelled = true }
  }, [storeId])

  // Day picker derived from event. Always render all three slots; a day is
  // "enabled" only when it has configured hours and isn't in the past.
  const dayInfos = useMemo(() => {
    if (!event || !config) return []
    return [1, 2, 3].map(d => {
      const dayNum = d as 1 | 2 | 3
      const dateStr = addDays(event.start_date, dayNum - 1)
      const hours = hoursForEventDay(dayNum, config as any, null)
      const enabled = !!hours && dateStr >= today
      return { dayNumber: dayNum, dateStr, hours, enabled }
    })
  }, [event, config, today])

  // Pull bookings + blocks for the selected event/date so the slot picker
  // reflects real availability. Declared BEFORE the slots useMemo so the
  // hoisted-but-not-initialized TDZ trap doesn't bite.
  const [existingForDay, setExistingForDay] = useState<any[]>([])
  const [blocksForDay, setBlocksForDay] = useState<any[]>([])

  const [dateStr, setDateStr] = useState<string>('')
  // Reset day + time whenever the event changes — no day pre-selected.
  useEffect(() => { setDateStr(''); }, [eventId])

  // Slot dropdown for the selected day (real availability via existing logic)
  const slots = useMemo(() => {
    if (!config || !event || !dateStr) return []
    const day = dayInfos.find(di => di.dateStr === dateStr)
    if (!day || !day.hours) return []
    return buildSlotsForDay({
      date: day.dateStr,
      startTime: day.hours.start,
      endTime: day.hours.end,
      intervalMinutes: config.slot_interval_minutes,
      maxConcurrent: config.max_concurrent_slots,
      bookings: existingForDay,
      blocks: blocksForDay,
    })
  }, [config, event, dateStr, dayInfos, existingForDay, blocksForDay])

  useEffect(() => {
    if (!event || !dateStr) return
    let cancelled = false
    Promise.all([
      supabase.from('appointments')
        .select('appointment_date, appointment_time, status')
        .eq('event_id', event.id)
        .eq('appointment_date', dateStr)
        .eq('status', 'confirmed'),
      supabase.from('slot_blocks')
        .select('block_date, block_time')
        .eq('event_id', event.id)
        .eq('block_date', dateStr),
    ]).then(([apptRes, blockRes]) => {
      if (cancelled) return
      setExistingForDay(apptRes.data || [])
      setBlocksForDay(blockRes.data || [])
    })
    return () => { cancelled = true }
  }, [event, dateStr])

  // Form state
  const [time, setTime] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [items, setItems] = useState<string[]>([])
  const [howHeard, setHowHeard] = useState<string[]>([])
  const [empId, setEmpId] = useState('')
  const [isWalkin, setIsWalkin] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Font scale switcher — defaults to Medium so the modal opens 2pt larger
  // than the historical "small" baseline. Persisted across sessions.
  const [fontScale, setFontScale] = useState<FontScale>('md')
  useEffect(() => {
    if (typeof window === 'undefined') return
    const saved = window.localStorage.getItem(FONT_SCALE_KEY)
    if (saved === 'sm' || saved === 'md' || saved === 'lg') setFontScale(saved)
  }, [])
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(FONT_SCALE_KEY, fontScale)
  }, [fontScale])
  const basePx = Math.round(14 * SCALE_MULTIPLIER[fontScale]) // 14 / 16 / 18

  function toggle(arr: string[], val: string, setter: (v: string[]) => void) {
    setter(arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val])
  }

  const itemsOptions = config?.items_options?.length ? config.items_options : DEFAULT_ITEMS
  const hearOptions = config?.hear_about_options?.length ? config.hear_about_options : DEFAULT_HEAR

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!store?.slug || !event) {
      setError('Pick a store and event.')
      return
    }
    if (!dateStr) {
      setError('Please select a day.')
      return
    }
    if (!time) {
      setError('Please select a time.')
      return
    }
    if (!name.trim() || !phone.trim()) {
      setError('Customer name and phone are required.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: store.slug,
          event_id: event.id,
          appointment_date: dateStr,
          appointment_time: time,
          customer_name: name.trim(),
          customer_phone: phone.trim(),
          customer_email: email.trim() || 'noemail@placeholder.local',
          items_bringing: items.length ? items : ['Not specified'],
          how_heard: howHeard,
          appointment_employee_id: empId || null,
          is_walkin: isWalkin,
          booked_by: 'admin',
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error || `Could not save (${res.status})`)
      } else {
        onCreated()
        onClose()
      }
    } catch (e: any) {
      setError(e?.message || 'Network error')
    }
    setSubmitting(false)
  }

  // Sizes are em-based so the entire modal scales from `basePx` on the form root.
  const labelSize = '0.857em'   // ≈ 12px at 14 base
  const inputSize = '1em'       // tracks base
  const titleSize = '1.286em'   // ≈ 18px at 14 base
  const checkboxLabelSize = '0.929em' // ≈ 13px at 14 base

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <form
        onSubmit={submit}
        className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-w-lg w-full overflow-y-auto"
        style={{
          fontSize: `${basePx}px`,
          // dvh tracks the *visible* viewport, so the modal won't extend behind
          // mobile browser chrome (URL bar) or the iPhone home indicator.
          maxHeight: 'calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom))',
        }}
      >
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between gap-2">
          <h2 className="font-bold" style={{ color: 'var(--ink)', fontSize: titleSize }}>Add appointment</h2>
          <div className="flex items-center gap-2">
            {/* Font size switcher — three "A" glyphs at small/medium/large sizes */}
            <div
              role="radiogroup"
              aria-label="Modal text size"
              style={{ display: 'flex', alignItems: 'center', gap: 2 }}
            >
              {([
                { v: 'sm' as const, size: 11 },
                { v: 'md' as const, size: 14 },
                { v: 'lg' as const, size: 17 },
              ]).map(({ v, size }) => {
                const sel = fontScale === v
                return (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={sel}
                    aria-label={SCALE_LABEL[v]}
                    title={SCALE_LABEL[v]}
                    onClick={() => setFontScale(v)}
                    style={{
                      width: 28, height: 28,
                      borderRadius: 6,
                      border: 'none',
                      background: sel ? '#e5e7eb' : 'transparent',
                      color: sel ? 'var(--ink)' : '#6b7280',
                      cursor: 'pointer',
                      fontWeight: 700,
                      fontSize: size,
                      fontFamily: 'inherit',
                      padding: 0, lineHeight: 1,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'background .15s ease, color .15s ease',
                    }}
                  >
                    A
                  </button>
                )
              })}
            </div>
            <button type="button" onClick={onClose} className="p-1" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-3">
          {slugStores.length === 0 ? (
            <div className="text-gray-700 bg-amber-50 border border-amber-200 rounded-lg p-3" style={{ fontSize: inputSize }}>
              No store has a slug set yet. Set one under <strong>Stores → store → Customer Booking URL & QR Codes</strong> first.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-gray-700 mb-1" style={{ fontSize: labelSize }}>Store</label>
                  <select className="w-full rounded-lg border border-gray-300 p-2 bg-white"
                    style={{ fontSize: inputSize }}
                    value={storeId} onChange={e => setStoreId(e.target.value)}>
                    {slugStores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1" style={{ fontSize: labelSize }}>Event</label>
                  <select className="w-full rounded-lg border border-gray-300 p-2 bg-white"
                    style={{ fontSize: inputSize }}
                    value={eventId} onChange={e => setEventId(e.target.value)}
                    disabled={storeEvents.length === 0}>
                    {storeEvents.length === 0 && <option value="">No upcoming events</option>}
                    {storeEvents.map(ev => (
                      <option key={ev.id} value={ev.id}>
                        {fmtDateLong(ev.start_date)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Day picker — three buttons, no default. Past / unconfigured days
                  are rendered disabled rather than hidden. */}
              <div>
                <label className="block font-semibold text-gray-700 mb-1" style={{ fontSize: labelSize }}>Day *</label>
                <div className="grid grid-cols-3 gap-2">
                  {dayInfos.length === 0 ? (
                    <div className="col-span-3 text-gray-500" style={{ fontSize: inputSize }}>No bookable days</div>
                  ) : dayInfos.map(di => {
                    const sel = di.dateStr === dateStr
                    return (
                      <button
                        key={di.dayNumber}
                        type="button"
                        disabled={!di.enabled}
                        aria-pressed={sel}
                        onClick={() => { setDateStr(di.dateStr); setTime('') }}
                        style={{
                          padding: '0.6em 0.4em',
                          borderRadius: 8,
                          border: '1.5px solid var(--green)',
                          background: sel ? 'var(--green)' : '#FFFFFF',
                          color: sel ? '#FFFFFF' : 'var(--green)',
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
                <select className="w-full rounded-lg border border-gray-300 p-2 bg-white"
                  style={{ fontSize: inputSize }}
                  value={time} onChange={e => setTime(e.target.value)} disabled={slots.length === 0}>
                  <option value="">— select —</option>
                  {slots.map(s => {
                    const unavail = s.isPast || s.blocked || s.available === 0
                    return (
                      <option key={s.time} value={s.time} disabled={unavail}>
                        {fmtTime(s.time)} {unavail ? '(full)' : `(${s.available} left)`}
                      </option>
                    )
                  })}
                </select>
              </div>

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
                <label className="block font-semibold text-gray-700 mb-2" style={{ fontSize: labelSize }}>Bringing</label>
                <div className="grid grid-cols-2 gap-2">
                  {itemsOptions.map(opt => (
                    <Checkbox key={opt} label={opt}
                      labelStyle={{ fontSize: checkboxLabelSize, padding: '4px 0' }}
                      checked={items.includes(opt)}
                      onChange={() => toggle(items, opt, setItems)} />
                  ))}
                </div>
              </div>

              <div>
                <label className="block font-semibold text-gray-700 mb-2" style={{ fontSize: labelSize }}>How heard (pick any)</label>
                <div className="grid grid-cols-2 gap-2">
                  {hearOptions.map(opt => (
                    <Checkbox key={opt} label={opt}
                      labelStyle={{ fontSize: checkboxLabelSize, padding: '4px 0' }}
                      checked={howHeard.includes(opt)}
                      onChange={() => toggle(howHeard, opt, setHowHeard)} />
                  ))}
                </div>
              </div>

              {employees.length > 0 && (
                <div>
                  <label className="block font-semibold text-gray-700 mb-1" style={{ fontSize: labelSize }}>Spiff to</label>
                  <select value={empId} onChange={e => setEmpId(e.target.value)}
                    style={{ fontSize: inputSize }}
                    className="w-full rounded-lg border border-gray-300 p-2 bg-white">
                    <option value="">— none —</option>
                    {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                  </select>
                </div>
              )}

              <Checkbox
                checked={isWalkin}
                onChange={setIsWalkin}
                label="Walk-in (customer is here in person now)"
                labelStyle={{ fontSize: checkboxLabelSize, paddingTop: 4 }}
              />

              {error && (
                <div className="text-red-700 bg-red-50 border border-red-200 rounded-lg p-2"
                  style={{ fontSize: inputSize }}>
                  {error}
                </div>
              )}

              <button type="submit" disabled={submitting}
                className="w-full rounded-lg p-3 text-white font-semibold disabled:opacity-50"
                style={{ background: 'var(--green)', fontSize: inputSize }}>
                {submitting ? 'Saving…' : 'Add appointment'}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  )
}
