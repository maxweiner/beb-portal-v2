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

  const fmtSlot = (slot: Slot) => {
    const start = new Date(slot.slot_start)
    const end = new Date(slot.slot_end)
    const day = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    const t = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    return `${day} · ${t(start)}–${t(end)}`
  }

  const primary = show?.store?.color_primary || '#1D6B44'
  const secondary = show?.store?.color_secondary || '#F5F0E8'

  return (
    <div style={{ minHeight: '100vh', background: secondary, padding: '6vh 16px', display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
      <div style={{ width: 'min(560px, 100%)', background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 10px 40px rgba(0,0,0,.08)', borderTop: `4px solid ${primary}` }}>
        {show?.store && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', borderBottom: '1px solid var(--pearl, #e2e8f0)' }}>
            {show.store.store_image_url ? (
              <img src={show.store.store_image_url} alt={`${show.store.name} logo`}
                style={{ height: 44, width: 'auto', maxWidth: 120, objectFit: 'contain', background: '#fff', borderRadius: 6 }} />
            ) : (
              <div style={{ height: 44, width: 44, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: secondary, color: primary, fontWeight: 900, fontSize: 18 }}>
                💎
              </div>
            )}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 800, color: primary, fontSize: 18, lineHeight: 1.2 }}>{show.store.name}</div>
              {(show.store.city || show.store.state) && (
                <div style={{ fontSize: 13, color: 'var(--mist, #64748b)', lineHeight: 1.2, marginTop: 2 }}>
                  {[show.store.city, show.store.state].filter(Boolean).join(', ')}
                </div>
              )}
            </div>
          </div>
        )}
        <div style={{ padding: 24 }}>
        {bookedSlot ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 36, marginBottom: 6 }}>✅</div>
            <h1 style={{ fontSize: 20, fontWeight: 900, color: primary, marginBottom: 6 }}>You're booked</h1>
            <div style={{ fontSize: 14, color: 'var(--ash)' }}>{show?.store?.name}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: primary, marginTop: 10 }}>{fmtSlot(bookedSlot)}</div>
            <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 12 }}>See you then.</div>
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
              <div style={{ fontSize: 11, fontWeight: 800, color: primary, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                Book a trunk show appointment
              </div>
              {show?.store?.address && (
                <div style={{ fontSize: 13, color: 'var(--ash)', marginTop: 4 }}>
                  {show.store.address}
                </div>
              )}
            </div>

            {slots.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--mist)', background: 'var(--cream)', borderRadius: 8 }}>
                No open slots right now. Check back later.
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
                      background: pickedSlotId === slot.id ? secondary : '#fff',
                      border: '1px solid ' + (pickedSlotId === slot.id ? primary : 'var(--cream2)'),
                      borderRadius: 6,
                    }}>
                      <input type="radio" name="slot" value={slot.id} checked={pickedSlotId === slot.id} onChange={() => setPickedSlotId(slot.id)} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{fmtSlot(slot)}</span>
                    </label>
                  ))}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{ marginBottom: 8 }}>
                  <input value={first} onChange={e => setFirst(e.target.value)} placeholder="Customer first name *" autoFocus />
                  <input value={last} onChange={e => setLast(e.target.value)} placeholder="Last name" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{ marginBottom: 8 }}>
                  <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" type="email" />
                  <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone" type="tel" />
                </div>
                <div className="field" style={{ marginBottom: 8 }}>
                  <label className="fl">Store salesperson (you, if you're the one booking)</label>
                  <input value={salesperson} onChange={e => setSalesperson(e.target.value)} placeholder="Your name" />
                </div>
                <div className="field" style={{ marginBottom: 8 }}>
                  <label className="fl">Notes</label>
                  <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Anything we should know?" />
                </div>

                <button onClick={submit} disabled={busy || !pickedSlotId || !first.trim()}
                  style={{ width: '100%', padding: '12px', marginTop: 8, border: 'none', borderRadius: 8, background: primary, color: '#fff', fontWeight: 800, fontSize: 14, cursor: busy || !pickedSlotId || !first.trim() ? 'not-allowed' : 'pointer', opacity: busy || !pickedSlotId || !first.trim() ? 0.5 : 1 }}>
                  {busy ? 'Booking…' : 'Book this time'}
                </button>
              </>
            )}
          </>
        )}
        </div>
      </div>
    </div>
  )
}
