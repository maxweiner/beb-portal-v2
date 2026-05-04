'use client'

// Public booth-appointment booking page. Visited via the magic
// link the booth team shares. No login required. Two-step flow:
// pick a trunk rep first, then pick one of that rep's available
// times. If only one rep has slots, the picker collapses to a
// banner.

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'

interface ShowInfo {
  id: string
  name: string
  venue_name: string | null
  venue_city: string | null
  venue_state: string | null
  start_date: string
  end_date: string
  booth_number: string | null
}

interface Slot {
  id: string
  slot_start: string
  slot_end: string
  assigned_staff_id: string | null
  assigned_staff_name: string | null
}

const UNASSIGNED_KEY = '__unassigned__'

export default function TradeShowBookPage() {
  const { token } = useParams() as { token: string }
  const [show, setShow] = useState<ShowInfo | null>(null)
  const [slots, setSlots] = useState<Slot[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pickedRep, setPickedRep] = useState<string>('')   // staff_id or UNASSIGNED_KEY
  const [pickedSlotId, setPickedSlotId] = useState<string>('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [bookedSlot, setBookedSlot] = useState<Slot | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/trade-show-booking/${token}`)
        const json = await res.json()
        if (cancelled) return
        if (!res.ok) { setError(json?.error || 'Could not load show'); setLoaded(true); return }
        setShow(json.show)
        setSlots(json.slots || [])
        setLoaded(true)
      } catch (err: any) {
        if (!cancelled) { setError(err?.message || 'Could not load show'); setLoaded(true) }
      }
    })()
    return () => { cancelled = true }
  }, [token])

  // Group slots by rep so the picker shows only reps that actually
  // have availability.
  const repBuckets = useMemo(() => {
    const m: Record<string, { name: string; slots: Slot[] }> = {}
    for (const s of slots) {
      const key = s.assigned_staff_id || UNASSIGNED_KEY
      const label = s.assigned_staff_name || 'Anyone available'
      if (!m[key]) m[key] = { name: label, slots: [] }
      m[key].slots.push(s)
    }
    return m
  }, [slots])

  const repList = Object.entries(repBuckets)
    .map(([key, v]) => ({ key, name: v.name, count: v.slots.length }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // Auto-pick when there's only one option. Saves a tap.
  useEffect(() => {
    if (!pickedRep && repList.length === 1) setPickedRep(repList[0].key)
  }, [repList, pickedRep])

  const repSlots = pickedRep ? (repBuckets[pickedRep]?.slots || []) : []

  // Group rep's slots by day for the time grid.
  const slotsByDay: Record<string, Slot[]> = {}
  for (const s of repSlots) {
    const d = s.slot_start.slice(0, 10)
    ;(slotsByDay[d] ||= []).push(s)
  }
  const dayKeys = Object.keys(slotsByDay).sort()

  async function submit() {
    if (!pickedSlotId || !name.trim() || busy) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/trade-show-booking/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId: pickedSlotId, name, email, phone, notes }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Could not book')
      const slot = slots.find(s => s.id === pickedSlotId) || null
      setBookedSlot(slot)
    } catch (err: any) {
      setError(err?.message || 'Could not book')
      setBusy(false)
    }
  }

  const fmtTime = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const fmtDayHeader = (iso: string) =>
    new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  // ── Confirmation ──────────────────────────────────────────────
  if (bookedSlot) {
    const start = new Date(bookedSlot.slot_start)
    return (
      <div className="min-h-screen pb-12" style={{ background: 'var(--cream)' }}>
        <main className="max-w-md mx-auto px-4 pt-10">
          <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
            <div style={{ fontSize: 44, marginBottom: 6 }}>✅</div>
            <h2 className="text-2xl font-bold mb-3">You're booked!</h2>
            <p className="text-gray-700 mb-2">
              We'll see you at <strong>{show?.name}</strong>{show?.booth_number ? <> · Booth <strong>{show.booth_number}</strong></> : null} on{' '}
              <strong>{fmtDayHeader(bookedSlot.slot_start.slice(0, 10))}</strong> at <strong>{fmtTime(start)}</strong>
              {bookedSlot.assigned_staff_name && <> with <strong>{bookedSlot.assigned_staff_name}</strong></>}.
            </p>
            <p className="text-sm text-gray-500 mt-4">Stop by the booth at your scheduled time.</p>
          </div>
        </main>
      </div>
    )
  }

  if (!loaded) return <div className="min-h-screen flex items-center justify-center text-gray-500" style={{ background: 'var(--cream)' }}>Loading…</div>
  if (error) return (
    <div className="min-h-screen p-8 text-center" style={{ background: 'var(--cream)' }}>
      <div style={{ fontSize: 36, marginBottom: 8 }}>🚫</div>
      <div className="font-bold text-red-700">{error}</div>
    </div>
  )

  return (
    <div className="min-h-screen pb-12" style={{ background: 'var(--cream)' }}>
      <main className="max-w-md mx-auto px-4 pt-6 space-y-6">
        <div>
          <div className="text-xs font-extrabold uppercase tracking-wider text-gray-500">Book a meeting at</div>
          <h1 className="text-2xl font-extrabold mt-1">{show?.name}</h1>
          <div className="text-sm text-gray-500 mt-1">
            {[show?.venue_name, show?.venue_city, show?.venue_state].filter(Boolean).join(' · ')}
            {show?.booth_number && <span className="ml-2 font-bold text-green-700">Booth {show.booth_number}</span>}
          </div>
        </div>

        {slots.length === 0 ? (
          <div className="bg-white rounded-2xl shadow p-6 text-center text-gray-500">
            No open slots right now. Stop by the booth or check back later.
          </div>
        ) : (
          <>
            {/* Step 1 — pick a rep */}
            <div className="bg-white rounded-2xl shadow p-5">
              <div className="text-xs font-extrabold uppercase tracking-wider text-gray-400 mb-3">
                Pick a rep
              </div>
              <div className="grid grid-cols-1 gap-2">
                {repList.map(r => {
                  const sel = pickedRep === r.key
                  return (
                    <button key={r.key} type="button"
                      onClick={() => { setPickedRep(r.key); setPickedSlotId('') }}
                      className="rounded-lg py-3 px-4 text-left transition-colors"
                      style={{
                        background: sel ? 'var(--green-pale)' : '#fff',
                        border: `1.5px solid ${sel ? 'var(--green)' : 'var(--pearl, #e2e8f0)'}`,
                      }}>
                      <div className="font-bold text-base">{r.name}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{r.count} slot{r.count === 1 ? '' : 's'} available</div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Step 2 — pick a time (only after rep picked) */}
            {pickedRep && repSlots.length > 0 && (
              <div className="bg-white rounded-2xl shadow overflow-hidden">
                <div className="px-5 pt-4 pb-1 text-xs font-extrabold uppercase tracking-wider text-gray-400">
                  Pick a time
                </div>
                <div className="px-3 pb-4 pt-2 space-y-4">
                  {dayKeys.map(day => (
                    <div key={day}>
                      <div className="px-2 pb-2 text-sm font-bold text-green-800">
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
                                background: sel ? 'var(--green)' : '#fff',
                                color: sel ? '#fff' : 'var(--ink)',
                                border: `1.5px solid ${sel ? 'var(--green)' : 'var(--pearl, #e2e8f0)'}`,
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
            )}

            {/* Step 3 — your details (only after time picked) */}
            {pickedSlotId && (
              <>
                <div className="bg-white rounded-2xl shadow p-5 space-y-3">
                  <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name *" autoFocus
                    className="w-full px-4 py-3 rounded-lg border text-base"
                    style={{ borderColor: 'var(--pearl, #e2e8f0)' }} />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" type="email"
                      className="w-full px-4 py-3 rounded-lg border text-base"
                      style={{ borderColor: 'var(--pearl, #e2e8f0)' }} />
                    <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone" type="tel"
                      className="w-full px-4 py-3 rounded-lg border text-base"
                      style={{ borderColor: 'var(--pearl, #e2e8f0)' }} />
                  </div>
                  <input value={notes} onChange={e => setNotes(e.target.value)}
                    placeholder="Anything we should know?"
                    className="w-full px-4 py-3 rounded-lg border text-base"
                    style={{ borderColor: 'var(--pearl, #e2e8f0)' }} />
                </div>
                <button onClick={submit} disabled={busy || !name.trim()}
                  className="block w-full rounded-xl py-4 text-white font-bold text-base"
                  style={{
                    background: 'var(--green-dark)',
                    opacity: busy || !name.trim() ? 0.5 : 1,
                    cursor: busy || !name.trim() ? 'not-allowed' : 'pointer',
                  }}>
                  {busy ? 'Booking…' : 'Book my time'}
                </button>
              </>
            )}
          </>
        )}
      </main>
    </div>
  )
}
