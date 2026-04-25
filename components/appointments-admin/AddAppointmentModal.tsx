'use client'

import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Store, Event } from '@/types'
import { buildSlotsForDay, hoursForEventDay } from '@/lib/appointments/slots'
import PhoneInput from '@/components/ui/PhoneInput'

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

  // Day picker derived from event
  const dayInfos = useMemo(() => {
    if (!event || !config) return []
    return [1, 2, 3].map(d => {
      const dayNum = d as 1 | 2 | 3
      const dateStr = addDays(event.start_date, dayNum - 1)
      const hours = hoursForEventDay(dayNum, config as any, null)
      return { dayNumber: dayNum, dateStr, hours }
    }).filter(di => di.hours && di.dateStr >= today)
  }, [event, config, today])
  const [dateStr, setDateStr] = useState<string>('')
  useEffect(() => { setDateStr(dayInfos[0]?.dateStr || '') }, [dayInfos])

  // Slot dropdown for the selected day (real availability via existing logic)
  const slots = useMemo(() => {
    if (!config || !event) return []
    const day = dayInfos.find(di => di.dateStr === dateStr)
    if (!day || !day.hours) return []
    // Pull current confirmed bookings + blocks just for the picked event so
    // availability counts are real. Fire-and-forget is OK because we re-fetch
    // every time dateStr changes.
    return buildSlotsForDay({
      date: day.dateStr,
      startTime: day.hours.start,
      endTime: day.hours.end,
      intervalMinutes: config.slot_interval_minutes,
      maxConcurrent: config.max_concurrent_slots,
      bookings: existingForDay,
      blocks: blocksForDay,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, event, dateStr])

  // Pull bookings + blocks for the selected event/date so the slot picker
  // reflects real availability.
  const [existingForDay, setExistingForDay] = useState<any[]>([])
  const [blocksForDay, setBlocksForDay] = useState<any[]>([])
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

  function toggle(arr: string[], val: string, setter: (v: string[]) => void) {
    setter(arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val])
  }

  const itemsOptions = config?.items_options?.length ? config.items_options : DEFAULT_ITEMS
  const hearOptions = config?.hear_about_options?.length ? config.hear_about_options : DEFAULT_HEAR

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!store?.slug || !event || !dateStr || !time) {
      setError('Pick a store, event, day, and time.')
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

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <form
        onSubmit={submit}
        className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-w-lg w-full max-h-[92vh] overflow-y-auto"
      >
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-bold" style={{ color: 'var(--ink)' }}>Add appointment</h2>
          <button type="button" onClick={onClose} className="p-1"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-3">
          {slugStores.length === 0 ? (
            <div className="text-sm text-gray-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
              No store has a slug set yet. Set one under <strong>Stores → store → Customer Booking URL & QR Codes</strong> first.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Store</label>
                  <select className="w-full rounded-lg border border-gray-300 p-2 text-sm bg-white"
                    value={storeId} onChange={e => setStoreId(e.target.value)}>
                    {slugStores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Event</label>
                  <select className="w-full rounded-lg border border-gray-300 p-2 text-sm bg-white"
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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Day</label>
                  <select className="w-full rounded-lg border border-gray-300 p-2 text-sm bg-white"
                    value={dateStr} onChange={e => { setDateStr(e.target.value); setTime('') }}
                    disabled={dayInfos.length === 0}>
                    {dayInfos.length === 0 && <option value="">No bookable days</option>}
                    {dayInfos.map(di => (
                      <option key={di.dateStr} value={di.dateStr}>
                        Day {di.dayNumber} ({fmtDateLong(di.dateStr)})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Time</label>
                  <select className="w-full rounded-lg border border-gray-300 p-2 text-sm bg-white"
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
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Customer name *</label>
                <input type="text" required value={name} onChange={e => setName(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 p-2 text-sm" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Phone *</label>
                  <PhoneInput required value={phone} onChange={v => setPhone(v)}
                    className="w-full rounded-lg border border-gray-300 p-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Email</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="(optional)"
                    className="w-full rounded-lg border border-gray-300 p-2 text-sm" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-2">Bringing</label>
                <div className="grid grid-cols-2 gap-2">
                  {itemsOptions.map(opt => {
                    const checked = items.includes(opt)
                    return (
                      <label key={opt} className="flex items-center gap-2 p-2 rounded-lg border text-xs cursor-pointer transition-colors"
                        style={checked ? { borderColor: 'var(--green)', background: 'var(--green-pale)' } : { borderColor: '#d1d5db' }}>
                        <input type="checkbox" checked={checked} onChange={() => toggle(items, opt, setItems)}
                          style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }} />
                        <span aria-hidden="true" style={{
                          width: 18, height: 18, flexShrink: 0, borderRadius: 4,
                          border: `2px solid ${checked ? 'var(--green)' : '#d1d5db'}`,
                          background: checked ? 'var(--green)' : '#FFFFFF',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: '#fff', fontSize: 12, fontWeight: 900, lineHeight: 1,
                        }}>{checked ? '✓' : ''}</span>
                        <span>{opt}</span>
                      </label>
                    )
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-2">How heard (pick any)</label>
                <div className="grid grid-cols-2 gap-2">
                  {hearOptions.map(opt => {
                    const checked = howHeard.includes(opt)
                    return (
                      <label key={opt} className="flex items-center gap-2 p-2 rounded-lg border text-xs cursor-pointer transition-colors"
                        style={checked ? { borderColor: 'var(--green)', background: 'var(--green-pale)' } : { borderColor: '#d1d5db' }}>
                        <input type="checkbox" checked={checked} onChange={() => toggle(howHeard, opt, setHowHeard)}
                          style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }} />
                        <span aria-hidden="true" style={{
                          width: 18, height: 18, flexShrink: 0, borderRadius: 4,
                          border: `2px solid ${checked ? 'var(--green)' : '#d1d5db'}`,
                          background: checked ? 'var(--green)' : '#FFFFFF',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: '#fff', fontSize: 12, fontWeight: 900, lineHeight: 1,
                        }}>{checked ? '✓' : ''}</span>
                        <span>{opt}</span>
                      </label>
                    )
                  })}
                </div>
              </div>

              {employees.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Spiff to</label>
                  <select value={empId} onChange={e => setEmpId(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 p-2 text-sm bg-white">
                    <option value="">— none —</option>
                    {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                  </select>
                </div>
              )}

              <label className="flex items-center gap-2 text-sm pt-1">
                <input type="checkbox" checked={isWalkin} onChange={e => setIsWalkin(e.target.checked)} />
                Walk-in (customer is here in person now)
              </label>

              {error && (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">
                  {error}
                </div>
              )}

              <button type="submit" disabled={submitting}
                className="w-full rounded-lg p-3 text-white font-semibold disabled:opacity-50"
                style={{ background: 'var(--green)' }}>
                {submitting ? 'Saving…' : 'Add appointment'}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  )
}
