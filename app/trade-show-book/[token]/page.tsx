'use client'

// Public booth-appointment booking page. Visited via the magic
// link the booth team shares. No login required. Loads available
// slots, the visitor picks one, fills name + contact, books it.

import { useEffect, useState } from 'react'
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
}

export default function TradeShowBookPage() {
  const { token } = useParams() as { token: string }
  const [show, setShow] = useState<ShowInfo | null>(null)
  const [slots, setSlots] = useState<Slot[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
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

  const fmtSlot = (slot: Slot) => {
    const start = new Date(slot.slot_start)
    const end = new Date(slot.slot_end)
    const day = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    const t = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    return `${day} · ${t(start)}–${t(end)}`
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--cream)', padding: '6vh 16px', display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
      <div style={{ width: 'min(560px, 100%)', background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 10px 40px rgba(0,0,0,.08)' }}>
        {bookedSlot ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 36, marginBottom: 6 }}>✅</div>
            <h1 style={{ fontSize: 20, fontWeight: 900, color: 'var(--ink)', marginBottom: 6 }}>You're booked</h1>
            <div style={{ fontSize: 14, color: 'var(--ash)' }}>
              {show?.name}{show?.booth_number ? ` · Booth ${show.booth_number}` : ''}
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--green-dark)', marginTop: 10 }}>
              {fmtSlot(bookedSlot)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 12 }}>
              We'll see you at the booth.
            </div>
          </div>
        ) : !loaded ? (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--mist)' }}>Loading…</div>
        ) : error ? (
          <div style={{ padding: 30, textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🚫</div>
            <div style={{ color: '#991B1B', fontWeight: 700 }}>{error}</div>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                Book a meeting at
              </div>
              <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)', marginTop: 4 }}>{show?.name}</h1>
              <div style={{ fontSize: 13, color: 'var(--ash)', marginTop: 2 }}>
                {[show?.venue_name, show?.venue_city, show?.venue_state].filter(Boolean).join(' · ')}
                {show?.booth_number && (
                  <span style={{ marginLeft: 8, fontWeight: 700, color: 'var(--green-dark)' }}>Booth {show.booth_number}</span>
                )}
              </div>
            </div>

            {slots.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--mist)', background: 'var(--cream)', borderRadius: 8 }}>
                No open slots right now. Check back later or stop by the booth.
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
                  Pick a time
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflowY: 'auto', marginBottom: 16, padding: 4, background: 'var(--cream)', borderRadius: 8 }}>
                  {slots.map(slot => (
                    <label key={slot.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 12px', cursor: 'pointer',
                      background: pickedSlotId === slot.id ? 'var(--green-pale)' : '#fff',
                      border: '1px solid ' + (pickedSlotId === slot.id ? 'var(--green3)' : 'var(--cream2)'),
                      borderRadius: 6,
                    }}>
                      <input type="radio" name="slot" value={slot.id} checked={pickedSlotId === slot.id} onChange={() => setPickedSlotId(slot.id)} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{fmtSlot(slot)}</span>
                    </label>
                  ))}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{ marginBottom: 8 }}>
                  <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name *" autoFocus />
                  <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" type="email" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{ marginBottom: 8 }}>
                  <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone" type="tel" />
                  <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Anything we should know?" />
                </div>

                <button
                  onClick={submit}
                  disabled={busy || !pickedSlotId || !name.trim()}
                  className="btn-primary"
                  style={{ width: '100%', padding: '12px', marginTop: 8 }}
                >
                  {busy ? 'Booking…' : 'Book my time'}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
