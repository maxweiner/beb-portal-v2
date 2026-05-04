'use client'

// Public trunk-show booking page. The store salesperson opens
// this link and either books a slot themselves or shares it with
// their customer. Captures first/last name, contact, and the
// salesperson's name (for spiff attribution).

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface ShowInfo {
  id: string
  start_date: string
  end_date: string
  store: {
    name: string
    city: string | null
    state: string | null
    address: string | null
    color_primary: string | null
    color_secondary: string | null
    store_image_url: string | null
  } | null
}

interface Slot { id: string; slot_start: string; slot_end: string }

export default function TrunkShowBookPage() {
  const { token } = useParams() as { token: string }
  const [show, setShow] = useState<ShowInfo | null>(null)
  const [slots, setSlots] = useState<Slot[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pickedSlotId, setPickedSlotId] = useState('')
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [salesperson, setSalesperson] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [bookedSlot, setBookedSlot] = useState<Slot | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/trunk-show-booking/${token}`)
        const json = await res.json()
        if (cancelled) return
        if (!res.ok) { setError(json?.error || 'Could not load'); setLoaded(true); return }
        setShow(json.show)
        setSlots(json.slots || [])
        setLoaded(true)
      } catch (err: any) {
        if (!cancelled) { setError(err?.message || 'Could not load'); setLoaded(true) }
      }
    })()
    return () => { cancelled = true }
  }, [token])

  async function submit() {
    if (!pickedSlotId || !first.trim() || busy) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/trunk-show-booking/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slotId: pickedSlotId,
          first_name: first, last_name: last,
          email, phone, salesperson, notes,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Could not book')
      setBookedSlot(slots.find(s => s.id === pickedSlotId) || null)
    } catch (err: any) {
      setError(err?.message || 'Could not book')
      setBusy(false)
    }
  }

  const fmtTime = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const fmtDayHeader = (iso: string) =>
    new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  // Group slots by day so the picker reads day-by-day instead of one
  // long flat list — much friendlier on mobile.
  const slotsByDay: Record<string, Slot[]> = {}
  for (const s of slots) {
    const d = s.slot_start.slice(0, 10)
    ;(slotsByDay[d] ||= []).push(s)
  }
  const dayKeys = Object.keys(slotsByDay).sort()

  const primary = show?.store?.color_primary || '#1D6B44'
  const secondary = show?.store?.color_secondary || '#F5F0E8'

  // ── Booked confirmation ───────────────────────────────────────
  if (bookedSlot) {
    const start = new Date(bookedSlot.slot_start)
    return (
      <div className="min-h-screen pb-12" style={{ background: secondary }}>
        <header className="px-5 pt-4 pb-3 bg-white flex items-center gap-3 max-w-md mx-auto"
          style={{ borderTop: `4px solid ${primary}`, paddingTop: 'max(env(safe-area-inset-top), 16px)' }}>
          {show?.store?.store_image_url ? (
            <img src={show.store.store_image_url} alt={`${show.store.name} logo`}
              className="h-10 w-auto max-w-[6rem] rounded-lg object-contain bg-white" />
          ) : (
            <div className="h-10 w-10 rounded-lg flex items-center justify-center"
              style={{ background: '#f3f4f6', color: primary, fontWeight: 900 }}>💎</div>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="font-extrabold leading-tight" style={{ color: primary, fontSize: '1.125rem' }}>{show?.store?.name}</div>
            {show?.store?.city && (
              <div className="text-gray-500 leading-tight" style={{ fontSize: '0.8125rem' }}>
                {show.store.city}{show.store.state ? `, ${show.store.state}` : ''}
              </div>
            )}
          </div>
        </header>
        <main className="max-w-md mx-auto px-4 pt-10">
          <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
            <div style={{ fontSize: 44, marginBottom: 6 }}>✅</div>
            <h2 className="text-2xl font-bold mb-3" style={{ color: primary }}>You're booked!</h2>
            <p className="text-gray-700 mb-2">
              We'll see you on <strong>{fmtDayHeader(bookedSlot.slot_start.slice(0, 10))}</strong> at{' '}
              <strong>{fmtTime(start)}</strong>.
            </p>
            <p className="text-sm text-gray-500 mt-4">A confirmation will be sent shortly.</p>
          </div>
        </main>
      </div>
    )
  }

  // ── Loading / error states ────────────────────────────────────
  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: secondary }}>
        <div className="text-gray-500">Loading…</div>
      </div>
    )
  }
  if (error) {
    return (
      <div className="min-h-screen p-8 text-center" style={{ background: secondary }}>
        <div style={{ fontSize: 36, marginBottom: 8 }}>🚫</div>
        <div className="font-bold" style={{ color: '#991B1B' }}>{error}</div>
      </div>
    )
  }

  // ── Booking form ──────────────────────────────────────────────
  return (
    <div className="min-h-screen pb-12" style={{ background: secondary }}>
      <header className="px-5 pt-4 pb-3 bg-white flex items-center gap-3 max-w-md mx-auto"
        style={{ borderTop: `4px solid ${primary}`, paddingTop: 'max(env(safe-area-inset-top), 16px)' }}>
        {show?.store?.store_image_url ? (
          <img src={show.store.store_image_url} alt={`${show.store.name} logo`}
            className="h-10 w-auto max-w-[6rem] rounded-lg object-contain bg-white" />
        ) : (
          <div className="h-10 w-10 rounded-lg flex items-center justify-center"
            style={{ background: '#f3f4f6', color: primary, fontWeight: 900 }}>💎</div>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="font-extrabold leading-tight" style={{ color: primary, fontSize: '1.125rem' }}>{show?.store?.name || 'Trunk Show'}</div>
          {show?.store?.city && (
            <div className="text-gray-500 leading-tight" style={{ fontSize: '0.8125rem' }}>
              {show.store.city}{show.store.state ? `, ${show.store.state}` : ''}
            </div>
          )}
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 pt-6 space-y-6">
        <div>
          <div className="text-xs font-extrabold uppercase tracking-wider" style={{ color: primary }}>Book a trunk show appointment</div>
          {show?.store?.address && (
            <div className="text-sm text-gray-500 mt-1">{show.store.address}</div>
          )}
        </div>

        {slots.length === 0 ? (
          <div className="bg-white rounded-2xl shadow p-6 text-center text-gray-500">
            No open slots right now. Check back later.
          </div>
        ) : (
          <>
            {/* Time picker — day-by-day with chip buttons */}
            <div className="bg-white rounded-2xl shadow overflow-hidden">
              <div className="px-5 pt-4 pb-1 text-xs font-extrabold uppercase tracking-wider text-gray-400">
                Pick a time
              </div>
              <div className="px-3 pb-4 pt-2 space-y-4">
                {dayKeys.map(day => (
                  <div key={day}>
                    <div className="px-2 pb-2 text-sm font-bold" style={{ color: primary }}>
                      {fmtDayHeader(day)}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {slotsByDay[day].map(slot => {
                        const start = new Date(slot.slot_start)
                        const sel = pickedSlotId === slot.id
                        return (
                          <button key={slot.id} type="button"
                            onClick={() => setPickedSlotId(slot.id)}
                            className="rounded-lg py-3 text-sm font-semibold transition-colors"
                            style={{
                              background: sel ? primary : '#fff',
                              color: sel ? '#fff' : 'var(--ink)',
                              border: `1.5px solid ${sel ? primary : 'var(--pearl, #e2e8f0)'}`,
                            }}>
                            {fmtTime(start)}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Customer details */}
            <div className="bg-white rounded-2xl shadow p-5 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input value={first} onChange={e => setFirst(e.target.value)} placeholder="First name *" autoFocus
                  className="w-full px-4 py-3 rounded-lg border text-base"
                  style={{ borderColor: 'var(--pearl, #e2e8f0)' }} />
                <input value={last} onChange={e => setLast(e.target.value)} placeholder="Last name"
                  className="w-full px-4 py-3 rounded-lg border text-base"
                  style={{ borderColor: 'var(--pearl, #e2e8f0)' }} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" type="email"
                  className="w-full px-4 py-3 rounded-lg border text-base"
                  style={{ borderColor: 'var(--pearl, #e2e8f0)' }} />
                <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone" type="tel"
                  className="w-full px-4 py-3 rounded-lg border text-base"
                  style={{ borderColor: 'var(--pearl, #e2e8f0)' }} />
              </div>
              <input value={salesperson} onChange={e => setSalesperson(e.target.value)}
                placeholder="Store salesperson (you, if you're booking)"
                className="w-full px-4 py-3 rounded-lg border text-base"
                style={{ borderColor: 'var(--pearl, #e2e8f0)' }} />
              <input value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Anything we should know?"
                className="w-full px-4 py-3 rounded-lg border text-base"
                style={{ borderColor: 'var(--pearl, #e2e8f0)' }} />
            </div>

            <button onClick={submit} disabled={busy || !pickedSlotId || !first.trim()}
              className="block w-full rounded-xl py-4 text-white font-bold text-base"
              style={{
                background: primary,
                opacity: busy || !pickedSlotId || !first.trim() ? 0.5 : 1,
                cursor: busy || !pickedSlotId || !first.trim() ? 'not-allowed' : 'pointer',
              }}>
              {busy ? 'Booking…' : 'Book this time'}
            </button>
          </>
        )}
      </main>
    </div>
  )
}
