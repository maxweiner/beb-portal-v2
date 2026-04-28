'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Diamond, Plus, X } from 'lucide-react'
import type { BookingPayload } from '@/lib/appointments/types'
import { formatPhoneDisplay } from '@/lib/phone'
import EditAppointmentModal from './EditAppointmentModal'
import AppointmentForm from '@/components/booking/AppointmentForm'

type FontScale = 'sm' | 'md' | 'lg'
const FONT_SCALE_KEY = 'addApptFontScale'
const SCALE_MULTIPLIER: Record<FontScale, number> = { sm: 1, md: 1.15, lg: 1.3 }
const SCALE_LABEL: Record<FontScale, string> = { sm: 'Small', md: 'Medium', lg: 'Large' }

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

export default function StorePortalClient({
  slug,
  payload,
  appointments,
  cancelledAppointments,
  employees,
}: {
  slug: string
  payload: BookingPayload
  appointments: FullAppt[]
  cancelledAppointments: FullAppt[]
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

  // Default to OPEN if the URL says ?add=1 — the QR/link in Store Portal
  // Access lands here so the customer skips the appointments list and goes
  // straight to booking.
  const [showAdd, setShowAdd] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return new URLSearchParams(window.location.search).get('add') === '1'
  })
  const [tab, setTab] = useState<'upcoming' | 'cancelled'>('upcoming')
  const [editingAppt, setEditingAppt] = useState<FullAppt | null>(null)

  // Font scale switcher — defaults to Medium so the modal opens 2pt larger
  // than the historical baseline. Persisted across sessions.
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

  // Group cancelled by date for the Cancelled tab
  const cancelledByDate = useMemo(() => {
    const m = new Map<string, FullAppt[]>()
    for (const a of cancelledAppointments) {
      if (!m.has(a.appointment_date)) m.set(a.appointment_date, [])
      m.get(a.appointment_date)!.push(a)
    }
    return [...m.entries()]
      .sort(([a], [b]) => b.localeCompare(a))   // most recent date first
      .map(([date, list]) => ({ date, list }))
  }, [cancelledAppointments])

  // Form state moved into AppointmentForm — surface keeps only the modal
  // toggle and post-success behaviour. The chosen slot is reported back
  // via onSuccess but the portal doesn't need it (the appointments list
  // re-renders from the server on router.refresh()).
  function onAddSuccess() {
    setShowAdd(false)
    router.refresh()
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
      <header className="px-4 pb-6 bg-white" style={{
        borderBottom: `4px solid ${primary}`,
        paddingTop: 'max(env(safe-area-inset-top), 32px)',
      }}>
        <div className="max-w-2xl mx-auto flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-extrabold leading-tight" style={{ color: primary }}>{store.name}</h1>
            {(store.owner_phone || store.owner_email) && (
              <div className="text-sm text-gray-700 mt-1 leading-snug">
                {store.owner_phone && <div>{formatPhoneDisplay(store.owner_phone)}</div>}
                {store.owner_email && <div className="break-all">{store.owner_email}</div>}
              </div>
            )}
            <p className="text-sm mt-2 text-gray-500">
              Store Portal — {appointments.length} upcoming appointment{appointments.length === 1 ? '' : 's'}
              {' · '}
              <a href="/install" target="_blank" rel="noreferrer" className="underline" style={{ color: primary }}>
                Install on iPhone
              </a>
            </p>
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
        {/* Tab toggle: Upcoming vs Cancelled */}
        <div className="flex gap-1 p-1 rounded-xl" style={{ background: '#e5e7eb' }}>
          {(['upcoming', 'cancelled'] as const).map(t => {
            const active = tab === t
            const count = t === 'upcoming' ? appointments.length : cancelledAppointments.length
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="flex-1 py-2 px-3 rounded-lg text-sm font-bold transition-colors"
                style={
                  active
                    ? { background: 'white', color: primary, boxShadow: '0 1px 2px rgba(0,0,0,.06)' }
                    : { background: 'transparent', color: '#6b7280' }
                }
              >
                {t === 'upcoming' ? 'Upcoming' : 'Cancelled'}
                {count > 0 && (
                  <span className="ml-1.5 text-xs opacity-70">({count})</span>
                )}
              </button>
            )
          })}
        </div>

        {tab === 'upcoming' && byDate.length === 0 && (
          <div className="bg-white rounded-2xl shadow p-8 text-center text-gray-500">
            No upcoming appointments.
          </div>
        )}
        {tab === 'cancelled' && cancelledByDate.length === 0 && (
          <div className="bg-white rounded-2xl shadow p-8 text-center text-gray-500">
            No cancelled appointments.
          </div>
        )}

        {(tab === 'upcoming' ? byDate : cancelledByDate).map(({ date, list }) => (
            <section key={date} className="bg-white rounded-2xl shadow overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-200 font-bold" style={{ background: primary + '14', color: primary }}>
                {formatDateLong(date)}
              </div>
              <div className="divide-y divide-gray-100">
                {list.map(a => (
                  <div key={a.id} className="p-4 flex items-start gap-3" style={{ opacity: tab === 'cancelled' ? 0.7 : 1 }}>
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
                        {tab === 'cancelled' && (
                          <span className="ml-2 text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded-full"
                            style={{ background: '#fee2e2', color: '#991b1b' }}>
                            cancelled
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
                    {tab === 'upcoming' && (
                      <button
                        onClick={() => setEditingAppt(a)}
                        className="text-xs font-semibold shrink-0 px-2.5 py-1 rounded-md border"
                        style={{ borderColor: primary, color: primary }}
                      >
                        Edit
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
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
      {showAdd && (() => {
        const labelSize = '0.857em'
        const inputSize = '1em'
        const titleSize = '1.286em'
        const checkboxLabelSize = '0.929em'
        return (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={e => { if (e.target === e.currentTarget) setShowAdd(false) }}
        >
          <div
            className="bg-white sm:rounded-2xl shadow-xl max-w-md w-full overflow-y-auto"
            style={{
              fontSize: `${basePx}px`,
              maxHeight: 'calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom))',
            }}
          >
            {/* Brand band — store name + logo so the customer always knows
                which store they're booking with, even when the modal covers
                the page header. */}
            <div className="px-5 pt-4 pb-3 flex items-center gap-3" style={{ borderTop: `4px solid ${primary}` }}>
              {store.store_image_url ? (
                <img src={store.store_image_url} alt="" className="h-10 w-10 rounded-lg object-cover" />
              ) : (
                <div className="h-10 w-10 rounded-lg flex items-center justify-center" style={{ background: '#f3f4f6', color: primary }}>
                  <Diamond className="h-5 w-5" strokeWidth={1.5} />
                </div>
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="font-extrabold leading-tight" style={{ color: primary, fontSize: '1em' }}>{store.name}</div>
                {store.city && (
                  <div className="text-gray-500 leading-tight" style={{ fontSize: '0.857em' }}>
                    {store.city}{store.state ? `, ${store.state}` : ''}
                  </div>
                )}
              </div>
            </div>

            <div className="px-5 py-3 border-y border-gray-200 flex items-center justify-between gap-2">
              <h2 className="font-bold" style={{ color: primary, fontSize: titleSize }}>Add appointment</h2>
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
                          color: sel ? '#111827' : '#6b7280',
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
                <button type="button" onClick={() => setShowAdd(false)} className="p-1" aria-label="Close">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-5">
              <AppointmentForm
                mode="portal"
                store={store}
                event={event}
                config={config}
                override={override || null}
                bookings={appointments.filter(a => a.status === 'confirmed').map(a => ({
                  appointment_date: a.appointment_date,
                  appointment_time: a.appointment_time,
                  status: 'confirmed',
                }))}
                blocks={blocks}
                employees={employees}
                slug={slug}
                bookedBy="store"
                onSuccess={onAddSuccess}
              />
            </div>
          </div>
        </div>
        )
      })()}
      {editingAppt && (
        <EditAppointmentModal
          appt={editingAppt}
          payload={payload}
          employees={employees}
          onClose={() => setEditingAppt(null)}
          onSaved={() => router.refresh()}
        />
      )}
    </div>
  )
}
