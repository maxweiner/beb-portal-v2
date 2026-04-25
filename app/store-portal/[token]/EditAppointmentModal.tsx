'use client'

import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { buildSlotsForDay, hoursForEventDay } from '@/lib/appointments/slots'
import type { BookingPayload } from '@/lib/appointments/types'
import PhoneInput from '@/components/ui/PhoneInput'
import Checkbox from '@/components/ui/Checkbox'

interface FullAppt {
  id: string
  cancel_token: string
  status: string
  appointment_date: string
  appointment_time: string
  customer_name: string
  customer_phone: string
  customer_email: string
  items_bringing: string[] | null
  how_heard: string[] | null
  is_walkin: boolean
  appointment_employee_id: string | null
}

interface Employee { id: string; name: string }

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function fmtDateLong(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
function fmtTime(t: string): string {
  const tt = t.length >= 5 ? t.slice(0, 5) : t
  const [h, m] = tt.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

export default function EditAppointmentModal({
  appt,
  payload,
  employees,
  onClose,
  onSaved,
}: {
  appt: FullAppt
  payload: BookingPayload
  employees: Employee[]
  onClose: () => void
  onSaved: () => void
}) {
  const { config, events, override } = payload
  const event = events[0]
  const primary = payload.store.color_primary || '#1D6B44'

  const initialTime = (appt.appointment_time || '').slice(0, 5)

  const dayInfos = useMemo(() => {
    if (!event) return []
    const today = todayIso()
    return event.days
      .map(d => {
        const dayNum = d.day_number as 1 | 2 | 3
        const dateStr = addDays(event.start_date, dayNum - 1)
        const hours = hoursForEventDay(dayNum, config, override)
        return { dayNumber: dayNum, dateStr, hours }
      })
      .filter(di => di.hours && (di.dateStr >= today || di.dateStr === appt.appointment_date))
  }, [event, config, override, appt.appointment_date])

  const [date, setDate] = useState(appt.appointment_date)
  const [time, setTime] = useState(initialTime)
  const [name, setName] = useState(appt.customer_name)
  const [phone, setPhone] = useState(appt.customer_phone)
  const [email, setEmail] = useState(appt.customer_email)
  const [items, setItems] = useState<string[]>(appt.items_bringing ?? [])
  const [howHeard, setHowHeard] = useState<string[]>(appt.how_heard ?? [])
  const [empId, setEmpId] = useState(appt.appointment_employee_id ?? '')
  const [isWalkin, setIsWalkin] = useState(!!appt.is_walkin)

  const [existingForDay, setExistingForDay] = useState<any[]>([])
  const [blocksForDay, setBlocksForDay] = useState<any[]>([])
  useEffect(() => {
    if (!event) return
    let cancelled = false
    Promise.all([
      supabase.from('appointments')
        .select('id, appointment_date, appointment_time, status')
        .eq('event_id', event.id)
        .eq('appointment_date', date)
        .eq('status', 'confirmed')
        .neq('id', appt.id),  // exclude self so the slot we're already in still shows as available
      supabase.from('slot_blocks')
        .select('block_date, block_time')
        .eq('event_id', event.id)
        .eq('block_date', date),
    ]).then(([apptRes, blockRes]) => {
      if (cancelled) return
      setExistingForDay(apptRes.data || [])
      setBlocksForDay(blockRes.data || [])
    })
    return () => { cancelled = true }
  }, [event, date, appt.id])

  const slots = useMemo(() => {
    if (!event) return []
    const day = dayInfos.find(di => di.dateStr === date)
    if (!day || !day.hours) return []
    return buildSlotsForDay({
      date: day.dateStr,
      startTime: day.hours.start,
      endTime: day.hours.end,
      intervalMinutes: config.slot_interval_minutes,
      maxConcurrent: override?.max_concurrent_slots ?? config.max_concurrent_slots,
      bookings: existingForDay,
      blocks: blocksForDay,
    })
  }, [event, dayInfos, date, config, override, existingForDay, blocksForDay])

  const [saving, setSaving] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggle(arr: string[], val: string, setter: (v: string[]) => void) {
    setter(arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val])
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!date || !time) { setError('Pick a day and time'); return }
    if (!name.trim() || !phone.trim()) { setError('Customer name and phone are required'); return }
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/appointments/${appt.cancel_token}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointment_date: date,
          appointment_time: time,
          customer_name: name.trim(),
          customer_phone: phone.trim(),
          customer_email: email.trim(),
          items_bringing: items,
          how_heard: howHeard,
          appointment_employee_id: empId || null,
          is_walkin: isWalkin,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error || `Could not save (${res.status})`)
      } else {
        onSaved(); onClose()
      }
    } catch (e: any) { setError(e?.message || 'Network error') }
    setSaving(false)
  }

  async function cancelAppointment() {
    if (!confirm(`Cancel ${appt.customer_name}'s appointment on ${fmtDateLong(date)} at ${fmtTime(time)}?\n\nThe time slot will be released immediately.`)) return
    setCancelling(true); setError(null)
    try {
      const res = await fetch(`/api/appointments/${appt.cancel_token}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error || `Could not cancel (${res.status})`)
      } else {
        onSaved(); onClose()
      }
    } catch (e: any) { setError(e?.message || 'Network error') }
    setCancelling(false)
  }

  const itemsOptions = config.items_options?.length ? config.items_options : ['Gold','Diamonds','Watches','Coins','Jewelry',"I'm Not Sure"]
  const hearOptions  = config.hear_about_options?.length ? config.hear_about_options : ['Large Postcard','Small Postcard','Newspaper','Email','Text','The Store Told Me']

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <form
        onSubmit={save}
        className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-w-lg w-full max-h-[92vh] overflow-y-auto"
      >
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-bold" style={{ color: primary }}>Edit appointment</h2>
          <button type="button" onClick={onClose} className="p-1"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Day</label>
              <select className="w-full rounded-lg border border-gray-300 p-2 text-sm bg-white"
                value={date} onChange={e => { setDate(e.target.value); setTime('') }}>
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
                value={time} onChange={e => setTime(e.target.value)}>
                <option value="">— select —</option>
                {slots.map(s => {
                  const unavail = s.isPast || s.blocked || s.available === 0
                  const isCurrent = s.time === initialTime && date === appt.appointment_date
                  return (
                    <option key={s.time} value={s.time} disabled={unavail && !isCurrent}>
                      {fmtTime(s.time)} {isCurrent ? '(current)' : unavail ? '(full)' : `(${s.available} left)`}
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
                className="w-full rounded-lg border border-gray-300 p-2 text-sm" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-2">Bringing</label>
            <div className="grid grid-cols-2 gap-2">
              {itemsOptions.map(opt => (
                <Checkbox key={opt} label={opt}
                  labelStyle={{ fontSize: 13, padding: '4px 0' }}
                  checked={items.includes(opt)}
                  onChange={() => toggle(items, opt, setItems)} />
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-2">How heard (pick any)</label>
            <div className="grid grid-cols-2 gap-2">
              {hearOptions.map(opt => (
                <Checkbox key={opt} label={opt}
                  labelStyle={{ fontSize: 13, padding: '4px 0' }}
                  checked={howHeard.includes(opt)}
                  onChange={() => toggle(howHeard, opt, setHowHeard)} />
              ))}
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

          <Checkbox
            checked={isWalkin}
            onChange={setIsWalkin}
            label="Walk-in (customer is here in person now)"
            labelStyle={{ fontSize: 13, paddingTop: 4 }}
          />

          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, paddingTop: 8 }}>
            <button type="button" onClick={onClose} disabled={saving || cancelling}
              className="px-4 py-2 rounded-lg text-sm font-semibold border border-gray-300">
              Close
            </button>
            <button type="submit" disabled={saving || cancelling}
              className="flex-1 rounded-lg p-2 text-white font-semibold disabled:opacity-50"
              style={{ background: primary }}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>

          {/* Destructive action lives at the bottom inside the edit form per spec */}
          <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12, marginTop: 8 }}>
            <button type="button" onClick={cancelAppointment} disabled={saving || cancelling}
              className="w-full rounded-lg p-2 font-semibold disabled:opacity-50"
              style={{ background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5' }}>
              {cancelling ? 'Cancelling…' : 'Cancel appointment'}
            </button>
            <p style={{ fontSize: 11, color: '#6b7280', marginTop: 4, textAlign: 'center' }}>
              The time slot is released immediately and a cancellation notice is sent to the customer.
            </p>
          </div>
        </div>
      </form>
    </div>
  )
}
