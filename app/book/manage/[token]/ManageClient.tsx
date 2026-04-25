'use client'

import { useState } from 'react'
import { Diamond } from 'lucide-react'
import { formatPhoneDisplay } from '@/lib/phone'

interface Appt {
  id: string
  cancel_token: string
  status: string
  appointment_date: string
  appointment_time: string
  customer_name: string
}

interface StoreLite {
  name: string
  slug: string | null
  color_primary: string | null
  color_secondary: string | null
  store_image_url: string | null
  owner_phone: string | null
  owner_email: string | null
}

function formatDateLong(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function formatTimePretty(hhmm: string): string {
  const t = hhmm.length >= 5 ? hhmm.slice(0, 5) : hhmm
  const [h, m] = t.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

export default function ManageClient({
  token,
  appt: initialAppt,
  store,
}: {
  token: string
  appt: Appt
  store: StoreLite
}) {
  const primary = store.color_primary || '#1D6B44'
  const secondary = store.color_secondary || '#F5F0E8'

  const [appt, setAppt] = useState(initialAppt)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isCancelled = appt.status === 'cancelled'

  async function handleCancel() {
    if (!confirm('Cancel this appointment? You can rebook anytime.')) return
    setWorking(true)
    setError(null)
    try {
      const res = await fetch(`/api/appointments/${token}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error || 'Could not cancel.')
      } else {
        setAppt(p => ({ ...p, status: 'cancelled' }))
      }
    } catch (err: any) {
      setError(err?.message || 'Network error.')
    }
    setWorking(false)
  }

  const rebookHref = store.slug ? `/book/${store.slug}` : null

  return (
    <div className="min-h-screen pb-12" style={{ background: secondary }}>
      <header className="px-4 pt-8 pb-6 bg-white" style={{ borderBottom: `4px solid ${primary}` }}>
        <div className="max-w-md mx-auto flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-extrabold leading-tight" style={{ color: primary }}>{store.name}</h1>
            {(store.owner_phone || store.owner_email) && (
              <div className="text-sm text-gray-700 mt-2 space-y-1 leading-tight">
                {store.owner_phone && <div>{formatPhoneDisplay(store.owner_phone)}</div>}
                {store.owner_email && <div className="break-all">{store.owner_email}</div>}
              </div>
            )}
            <p className="text-base mt-4 text-gray-700">Manage your appointment</p>
          </div>
          <div className="shrink-0">
            {store.store_image_url ? (
              <img src={store.store_image_url} alt={`${store.name} logo`}
                className="h-28 w-28 rounded-xl object-cover" />
            ) : (
              <div className="h-28 w-28 rounded-xl flex items-center justify-center"
                style={{ background: '#f3f4f6', color: primary }}>
                <Diamond className="h-12 w-12" strokeWidth={1.5} />
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 pt-6">
        <div className="bg-white rounded-2xl shadow p-5 space-y-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Booked for
            </div>
            <div className="text-lg font-bold mt-1">
              {appt.customer_name}
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              When
            </div>
            <div className="text-lg font-bold mt-1">
              {formatDateLong(appt.appointment_date)}
            </div>
            <div className="text-base">
              {formatTimePretty(appt.appointment_time)}
            </div>
          </div>

          <div className="rounded-lg p-3 text-sm font-semibold" style={
            isCancelled
              ? { background: '#fee2e2', color: '#b91c1c' }
              : { background: primary + '14', color: primary }
          }>
            Status: {isCancelled ? 'Cancelled' : 'Confirmed'}
          </div>

          {!isCancelled && rebookHref && (
            <a
              href={`${rebookHref}?reschedule=${token}`}
              className="block w-full text-center rounded-lg p-3 font-semibold text-white"
              style={{ background: primary }}
            >
              Reschedule
            </a>
          )}

          {!isCancelled && (
            <button
              onClick={handleCancel}
              disabled={working}
              className="w-full rounded-lg p-3 font-semibold border-2 disabled:opacity-50"
              style={{ borderColor: '#dc2626', color: '#dc2626', background: 'white' }}
            >
              {working ? 'Cancelling…' : 'Cancel this appointment'}
            </button>
          )}

          {isCancelled && rebookHref && (
            <a
              href={rebookHref}
              className="block w-full text-center rounded-lg p-3 font-semibold text-white"
              style={{ background: primary }}
            >
              Book another time
            </a>
          )}

          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
              {error}
            </div>
          )}
        </div>

      </main>
    </div>
  )
}
