'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Diamond, Plus, X } from 'lucide-react'
import { buildSlotsForDay, hoursForEventDay } from '@/lib/appointments/slots'
import type { BookingPayload } from '@/lib/appointments/types'
import PhoneInput from '@/components/ui/PhoneInput'
import Checkbox from '@/components/ui/Checkbox'
import { formatPhoneDisplay } from '@/lib/phone'

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
  how_heard: string | null
  is_walkin: boolean
  appointment_employee_id: string | null
  booked_by: string
}

interface Employee { id: string; name: string }

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDateLong(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

function formatTime(hhmm: string): string {
  const t = hhmm.length >= 5 ? hhmm.slice(0, 5) : hhmm
  const [h, m] = t.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

export default function StorePortalClient({
  slug,
  payload,
  appointments,
  employees,
}: {
  slug: string
  payload: BookingPayload
  appointments: FullAppt[]
  employees: Employee[]
}) {
  const router = useRouter()
  const { store, config, events, override, blocks } = payload
  const primary = store.color_primary || '#1D6B44'
  const secondary = store.color_secondary || '#F5F0E8'

  const event = events[0]

  // Group appointments by date for display
  const byDate = useMemo(() => {
    const m = new Map<string, FullAppt[]>()
    for (const a of appointments) {
      if (!m.has(a.appointment_date)) m.set(a.appointment_date, [])
      m.get(a.appointment_date)!.push(a)
    }
    return [...m.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, list]) => ({ date, list }))
  }, [appointments])

  const employeeName = (id: string | null) =>
    id ? employees.find(e => e.id === id)?.name || '—' : '—'

  const [showAdd, setShowAdd] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Add-form state
  const dayInfos = useMemo(() => {
    if (!event) return []
    const today = todayIso()
    return event.days
      .map(d => {
        const dayNumber = d.day_number as 1 | 2 | 3
        const dateStr = addDays(event.start_date, dayNumber - 1)
        const hours = hoursForEventDay(dayNumber, config, override)
        return { dayNumber, dateStr, hours }
      })
      .filter(di => di.dateStr >= today)
  }, [event, config, override])

  const [formDate, setFormDate] = useState<string>(dayInfos[0]?.dateStr ?? '')
  const [formTime, setFormTime] = useState<string>('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [items, setItems] = useState('')
  const [howHeard, setHowHeard] = useState<string[]>([])

  function toggleHowHeard(opt: string) {
    setHowHeard(prev => (prev.includes(opt) ? prev.filter(s => s !== opt) : [...prev, opt]))
  }
  const [empId, setEmpId] = useState<string>('')
  const [isWalkin, setIsWalkin] = useState(false)

  const formDay = dayInfos.find(d => d.dateStr === formDate) ?? null

  const formSlots = useMemo(() => {
    if (!formDay || !formDay.hours) return []
    return buildSlotsForDay({
      date: formDay.dateStr,
      startTime: formDay.hours.start,
      endTime: formDay.hours.end,
      intervalMinutes: config.slot_interval_minutes,
      maxConcurrent: override?.max_concurrent_slots ?? config.max_concurrent_slots,
      // Use the appointments list directly — it's our most up-to-date view.
      bookings: appointments
        .filter(a => a.status === 'confirmed')
        .map(a => ({
          appointment_date: a.appointment_date,
          appointment_time: a.appointment_time,
          status: 'confirmed' as const,
        })),
      blocks,
    })
  }, [formDay, config, override, appointments, blocks])

  function resetAddForm() {
    setFormDate(dayInfos[0]?.dateStr ?? '')
    setFormTime('')
    setName(''); setPhone(''); setEmail('')
    setItems(''); setHowHeard([]); setEmpId(''); setIsWalkin(false)
    setError(null)
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!formDate || !formTime) {
      setError('Pick a day and time')
      return
    }
    setWorking(true)
    setError(null)
    try {
      const res = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          event_id: event.id,
          appointment_date: formDate,
          appointment_time: formTime,
          customer_name: name,
          customer_phone: phone,
          customer_email: email || 'noemail@placeholder.local',
          items_bringing: items.split(',').map(s => s.trim()).filter(Boolean).length
            ? items.split(',').map(s => s.trim()).filter(Boolean)
            : ['Not specified'],
          how_heard: howHeard.length > 0 ? howHeard : ['The Store Told Me'],
          appointment_employee_id: empId || null,
          is_walkin: isWalkin,
          booked_by: 'store',
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error || `Could not save (${res.status})`)
      } else {
        setShowAdd(false)
        resetAddForm()
        router.refresh()
      }
    } catch (err: any) {
      setError(err?.message || 'Network error')
    }
    setWorking(false)
  }

  async function handleCancel(token: string) {
    if (!confirm('Cancel this appointment?')) return
    const res = await fetch(`/api/appointments/${token}`, { method: 'DELETE' })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      alert('Could not cancel: ' + (json.error || res.status))
      return
    }
    router.refresh()
  }

  return (
    <div className="min-h-screen pb-24" style={{ background: secondary }}>
      <header className="px-4 pt-8 pb-6 bg-white" style={{ borderBottom: `4px solid ${primary}` }}>
        <div className="max-w-2xl mx-auto flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-extrabold leading-tight" style={{ color: primary }}>{store.name}</h1>
            {(store.owner_phone || store.owner_email) && (
              <div className="text-sm text-gray-700 mt-1 leading-snug">
                {store.owner_phone && <div>{formatPhoneDisplay(store.owner_phone)}</div>}
                {store.owner_email && <div className="break-all">{store.owner_email}</div>}
              </div>
            )}
            <p className="text-sm mt-2 text-gray-500">Store Portal — {appointments.length} upcoming appointment{appointments.length === 1 ? '' : 's'}</p>
          </div>
          <div className="shrink-0">
            {store.store_image_url ? (
              <img src={store.store_image_url} alt="" className="h-28 w-28 rounded-xl object-cover" />
            ) : (
              <div className="h-28 w-28 rounded-xl flex items-center justify-center" style={{ background: '#f3f4f6', color: primary }}>
                <Diamond className="h-12 w-12" strokeWidth={1.5} />
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-6 space-y-5">
        {byDate.length === 0 ? (
          <div className="bg-white rounded-2xl shadow p-8 text-center text-gray-500">
            No upcoming appointments.
          </div>
        ) : (
          byDate.map(({ date, list }) => (
            <section key={date} className="bg-white rounded-2xl shadow overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-200 font-bold" style={{ background: primary + '14', color: primary }}>
                {formatDateLong(date)}
              </div>
              <div className="divide-y divide-gray-100">
                {list.map(a => (
                  <div key={a.id} className="p-4 flex items-start gap-3">
                    <div className="text-lg font-bold w-24 shrink-0">{formatTime(a.appointment_time)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold">
                        {a.customer_name}
                        {a.is_walkin && (
                          <span className="ml-2 text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded-full"
                            style={{ background: '#FEF3C7', color: '#92400E' }}>
                            walk-in
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {formatPhoneDisplay(a.customer_phone)}
                        {a.customer_email ? ` · ${a.customer_email}` : ''}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        Spiff: <span className="font-medium">{employeeName(a.appointment_employee_id)}</span>
                        {' · '}Booked by: {a.booked_by}
                      </div>
                      {a.items_bringing && a.items_bringing.length > 0 && (
                        <div className="text-xs text-gray-500 mt-0.5">
                          Bringing: {a.items_bringing.join(', ')}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => handleCancel(a.cancel_token)}
                      className="text-xs text-red-700 hover:underline shrink-0"
                    >
                      Cancel
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ))
        )}
      </main>

      {/* Floating "+" button */}
      <button
        onClick={() => setShowAdd(true)}
        className="fixed bottom-6 right-6 rounded-full text-white shadow-lg flex items-center justify-center"
        style={{ background: primary, width: 60, height: 60 }}
        aria-label="Add appointment"
      >
        <Plus className="w-7 h-7" />
      </button>

      {/* Add appointment modal */}
      {showAdd && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={e => { if (e.target === e.currentTarget) setShowAdd(false) }}
        >
          <form
            onSubmit={handleAdd}
            className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto"
          >
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-bold" style={{ color: primary }}>Add appointment</h2>
              <button type="button" onClick={() => setShowAdd(false)} className="p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Day</label>
                  <select
                    className="w-full rounded-lg border border-gray-300 p-2 text-sm bg-white"
                    value={formDate}
                    onChange={e => { setFormDate(e.target.value); setFormTime('') }}
                  >
                    {dayInfos.map(di => (
                      <option key={di.dateStr} value={di.dateStr}>
                        Day {di.dayNumber} ({formatDateLong(di.dateStr)})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Time</label>
                  <select
                    className="w-full rounded-lg border border-gray-300 p-2 text-sm bg-white"
                    value={formTime}
                    onChange={e => setFormTime(e.target.value)}
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
                <label className="block text-xs font-semibold text-gray-700 mb-1">Bringing</label>
                <input type="text" value={items} onChange={e => setItems(e.target.value)}
                  placeholder="Gold, Diamonds (comma separated)"
                  className="w-full rounded-lg border border-gray-300 p-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">How heard (pick any)</label>
                <div className="grid grid-cols-2 gap-2">
                  {config.hear_about_options.map(opt => {
                    const checked = howHeard.includes(opt)
                    return (
                      <label
                        key={opt}
                        className="flex items-center gap-2 p-2 rounded-lg border text-xs cursor-pointer transition-colors"
                        style={
                          checked
                            ? { borderColor: primary, background: primary + '14' }
                            : { borderColor: '#d1d5db' }
                        }
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
                <label className="block text-xs font-semibold text-gray-700 mb-1">Spiff to</label>
                <select value={empId} onChange={e => setEmpId(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 p-2 text-sm bg-white">
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
                labelStyle={{ fontSize: 13, paddingTop: 4 }}
              />

              {error && (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={working}
                className="w-full rounded-lg p-3 text-white font-semibold disabled:opacity-50"
                style={{ background: primary }}
              >
                {working ? 'Saving…' : 'Add appointment'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
