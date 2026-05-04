'use client'

// Trunk Customer Bookings panel: per-day slot grid for a trunk
// show, manual booking, mark purchased (Phase 13 will compute
// spiffs off this), magic-link booking URL.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import { QRCodeSVG } from 'qrcode.react'
import {
  listSlots, createSlot, bulkCreateSlots, bookSlot, setStatus,
  deleteSlot, generateBookingToken,
  type TrunkShowSlot, type TrunkShowAppointmentStatus,
} from '@/lib/sales/trunkShowAppointments'
import { makeSquareLogoDataUrl } from '@/lib/qr/squareLogo'
import { supabase } from '@/lib/supabase'
import type { TrunkShowHours, Store } from '@/types'
import TimePicker from '@/components/ui/TimePicker'

const STATUS_LABEL: Record<TrunkShowAppointmentStatus, string> = {
  available: 'Open', booked: 'Booked', completed: 'Done', cancelled: 'Cancelled', no_show: 'No-show',
}
const STATUS_COLOR: Record<TrunkShowAppointmentStatus, { bg: string; fg: string }> = {
  available: { bg: '#E5E7EB', fg: '#374151' },
  booked:    { bg: '#DBEAFE', fg: '#1E40AF' },
  completed: { bg: '#D1FAE5', fg: '#065F46' },
  cancelled: { bg: '#FEE2E2', fg: '#991B1B' },
  no_show:   { bg: '#FEF3C7', fg: '#92400E' },
}

interface Props {
  trunkShowId: string
  hours: TrunkShowHours[]
  canWrite: boolean
  store?: Store | null
}

export default function TrunkShowAppointmentsPanel({ trunkShowId, hours, canWrite, store }: Props) {
  const { user } = useApp()
  const [rows, setRows] = useState<TrunkShowSlot[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bookingFor, setBookingFor] = useState<string | null>(null)
  const [adderOpen, setAdderOpen] = useState(false)
  const [tokenUrl, setTokenUrl] = useState<string | null>(null)
  const [tokenBusy, setTokenBusy] = useState(false)
  const [qrLogo, setQrLogo] = useState<string | null>(null)

  // Build a square center-logo for the QR (store logo letterboxed, or
  // initials on the store's primary color). Mirrors the buying-side QR
  // pattern in StorePortalAccessCard.
  useEffect(() => {
    if (!tokenUrl || !store) return
    let cancelled = false
    void makeSquareLogoDataUrl({
      logoUrl: store.store_image_url || null,
      storeName: store.name || 'Store',
      color: store.color_primary || '#1D6B44',
      size: 256,
    }).then(url => { if (!cancelled) setQrLogo(url) })
      .catch(() => { if (!cancelled) setQrLogo(null) })
    return () => { cancelled = true }
  }, [tokenUrl, store])

  async function reload() {
    setError(null)
    try { setRows(await listSlots(trunkShowId)) }
    catch (err: any) { setError(err?.message || 'Failed to load') }
    setLoaded(true)
  }
  useEffect(() => { void reload() /* eslint-disable-next-line */ }, [trunkShowId])

  const grouped = useMemo(() => {
    const m: Record<string, TrunkShowSlot[]> = {}
    for (const r of rows) {
      const d = r.slot_start.slice(0, 10)
      ;(m[d] ||= []).push(r)
    }
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b))
  }, [rows])

  async function handleGenerateToken() {
    if (tokenBusy) return
    setTokenBusy(true); setError(null)
    try {
      const { url } = await generateBookingToken(trunkShowId)
      setTokenUrl(url)
    } catch (err: any) { setError(err?.message || 'Could not generate link') }
    setTokenBusy(false)
  }

  async function handleStatus(id: string, st: TrunkShowAppointmentStatus) {
    try { await setStatus(id, st); setRows(p => p.map(r => r.id === id ? { ...r, status: st } : r)) }
    catch (e: any) { alert(e?.message || 'Could not update') }
  }
  async function handlePurchased(id: string, purchased: boolean) {
    // Routes through the server endpoint so the spiff row is
    // created (or removed) in the same call. Spiff writes need
    // service role per RLS — this keeps the rep's flow simple.
    try {
      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token
      const res = await fetch(`/api/trunk-show-slots/${id}/purchase`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ purchased }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || `Save failed (${res.status})`)
      setRows(p => p.map(r => r.id === id ? {
        ...r, purchased,
        purchased_marked_by: purchased ? user?.id || null : null,
        purchased_marked_at: purchased ? new Date().toISOString() : null,
      } : r))
      if (json.notice) alert(json.notice)
    } catch (e: any) {
      alert(e?.message || 'Could not save')
    }
  }
  async function handleDelete(id: string) {
    if (!confirm('Delete this slot?')) return
    try { await deleteSlot(id); setRows(p => p.filter(r => r.id !== id)) }
    catch (e: any) { alert(e?.message || 'Could not delete') }
  }

  return (
    <div className="card" style={{ padding: 20, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>👥 Trunk Customer Bookings</div>
          <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 2 }}>
            Slots customers book via the magic link (or rep books manually). Captures the store salesperson for spiff tracking.
          </div>
        </div>
        {canWrite && (
          <button onClick={handleGenerateToken} disabled={tokenBusy} className="btn-outline btn-sm">
            {tokenBusy ? '…' : (tokenUrl ? 'New magic link' : 'Generate booking link')}
          </button>
        )}
      </div>

      {tokenUrl && (
        <div style={{
          background: 'var(--green-pale)', border: '1px solid var(--green3)',
          borderRadius: 8, padding: 12, marginBottom: 10,
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <div style={{ background: '#fff', padding: 6, borderRadius: 6, flexShrink: 0 }}>
            <QRCodeSVG
              value={tokenUrl}
              size={104}
              includeMargin={false}
              level="H"
              imageSettings={qrLogo ? {
                src: qrLogo,
                height: 104 * 0.22,
                width: 104 * 0.22,
                excavate: true,
              } : undefined}
            />
          </div>
          <div style={{ flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--green-dark)' }}>📎 Share with the store:</span>
            <code style={{ fontSize: 11, color: 'var(--ink)', overflow: 'auto', whiteSpace: 'nowrap', background: '#fff', padding: '6px 8px', borderRadius: 4 }}>{tokenUrl}</code>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => navigator.clipboard?.writeText(tokenUrl).catch(() => {})} className="btn-outline btn-xs">Copy link</button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div style={{ background: '#FEE2E2', color: '#991B1B', padding: '8px 10px', borderRadius: 6, fontSize: 13, marginBottom: 10 }}>{error}</div>
      )}

      {!loaded ? (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--mist)', fontSize: 13 }}>Loading…</div>
      ) : grouped.length === 0 ? (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--mist)', fontSize: 13, fontStyle: 'italic' }}>
          No slots yet.{canWrite && ' Click "+ Add slots" to fill every day at 30-minute intervals.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {grouped.map(([date, slots]) => (
            <div key={date}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>
                {new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                <span style={{ marginLeft: 8, color: 'var(--ash)' }}>· {slots.length} slot{slots.length === 1 ? '' : 's'}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {slots.map(slot => (
                  <SlotRow
                    key={slot.id}
                    slot={slot}
                    canWrite={canWrite}
                    bookingOpen={bookingFor === slot.id}
                    onBookClick={() => setBookingFor(slot.id)}
                    onBookCancel={() => setBookingFor(null)}
                    onBooked={() => { setBookingFor(null); void reload() }}
                    onStatus={(s) => handleStatus(slot.id, s)}
                    onTogglePurchased={() => handlePurchased(slot.id, !slot.purchased)}
                    onDelete={() => handleDelete(slot.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {canWrite && (
        adderOpen ? (
          <SlotAdder
            hours={hours}
            onCancel={() => setAdderOpen(false)}
            onAdded={() => { setAdderOpen(false); void reload() }}
            trunkShowId={trunkShowId}
          />
        ) : (
          <button onClick={() => setAdderOpen(true)} className="btn-outline btn-sm" style={{ marginTop: 10 }}>
            + Add slots
          </button>
        )
      )}
    </div>
  )
}

/* ── single slot row ─────────────────────────────────────── */

function SlotRow({
  slot, canWrite, bookingOpen, onBookClick, onBookCancel, onBooked,
  onStatus, onTogglePurchased, onDelete,
}: {
  slot: TrunkShowSlot
  canWrite: boolean
  bookingOpen: boolean
  onBookClick: () => void
  onBookCancel: () => void
  onBooked: () => void
  onStatus: (s: TrunkShowAppointmentStatus) => void
  onTogglePurchased: () => void
  onDelete: () => void
}) {
  const sc = STATUS_COLOR[slot.status]
  const t = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const customerName = [slot.customer_first_name, slot.customer_last_name].filter(Boolean).join(' ')

  return (
    <div style={{
      background: 'var(--cream)', borderRadius: 8, padding: '10px 12px',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)', minWidth: 90 }}>
          {t(slot.slot_start)} – {t(slot.slot_end)}
        </span>
        <span style={{ background: sc.bg, color: sc.fg, padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em' }}>
          {STATUS_LABEL[slot.status]}
        </span>
        {slot.purchased && (
          <span style={{ background: 'var(--green-pale)', color: 'var(--green-dark)', padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', border: '1px solid var(--green3)' }}>
            💵 Purchased
          </span>
        )}
        {customerName && (
          <span style={{ fontSize: 12, color: 'var(--ash)' }}>
            {customerName}
            {slot.store_salesperson_name && (
              <span style={{ color: 'var(--mist)', marginLeft: 6 }}>via {slot.store_salesperson_name}</span>
            )}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {canWrite && (
          <>
            {slot.status === 'available' && (
              <button onClick={onBookClick} className="btn-outline btn-xs">Book</button>
            )}
            {slot.status === 'booked' && (
              <>
                <button onClick={onTogglePurchased} className="btn-outline btn-xs">
                  {slot.purchased ? 'Unmark purchase' : '💵 Mark purchased'}
                </button>
                <button onClick={() => onStatus('completed')} className="btn-outline btn-xs">Done</button>
                <button onClick={() => onStatus('no_show')} className="btn-outline btn-xs">No-show</button>
                <button onClick={() => onStatus('cancelled')} className="btn-outline btn-xs">Cancel</button>
              </>
            )}
            {slot.status === 'completed' && !slot.purchased && (
              <button onClick={onTogglePurchased} className="btn-outline btn-xs">💵 Mark purchased</button>
            )}
            {slot.status === 'completed' && slot.purchased && (
              <button onClick={onTogglePurchased} className="btn-outline btn-xs">Unmark purchase</button>
            )}
            {slot.status !== 'available' && (
              <button onClick={() => onStatus('available')} className="btn-outline btn-xs" title="Reset to open">↺</button>
            )}
            {slot.status === 'available' && (
              <button onClick={onDelete} aria-label="Delete slot"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--mist)', fontSize: 14 }}>×</button>
            )}
          </>
        )}
      </div>
      {bookingOpen && (
        <BookingForm slotId={slot.id} onCancel={onBookCancel} onBooked={onBooked} />
      )}
    </div>
  )
}

/* ── booking form ────────────────────────────────────────── */

function BookingForm({ slotId, onCancel, onBooked }: {
  slotId: string
  onCancel: () => void
  onBooked: () => void
}) {
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [salesperson, setSalesperson] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    if (!first.trim() || busy) return
    setBusy(true); setErr(null)
    try {
      await bookSlot(slotId, {
        customer_first_name: first,
        customer_last_name: last,
        customer_email: email,
        customer_phone: phone,
        store_salesperson_name: salesperson,
        notes,
      })
      onBooked()
    } catch (e: any) { setErr(e?.message || 'Could not book'); setBusy(false) }
  }

  return (
    <div style={{ background: 'var(--green-pale)', border: '1px dashed var(--green3)', borderRadius: 6, padding: 10 }}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2" style={{ marginBottom: 6 }}>
        <input value={first} onChange={e => setFirst(e.target.value)} placeholder="Customer first name *" autoFocus />
        <input value={last} onChange={e => setLast(e.target.value)} placeholder="Last name" />
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" type="email" />
        <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone" type="tel" />
        <input value={salesperson} onChange={e => setSalesperson(e.target.value)} placeholder="Store salesperson (for spiff)" />
        <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes" />
      </div>
      {err && <div style={{ color: '#991B1B', fontSize: 12, marginBottom: 6 }}>{err}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onCancel} className="btn-outline btn-xs">Cancel</button>
        <button onClick={submit} disabled={busy || !first.trim()} className="btn-primary btn-xs">{busy ? 'Booking…' : 'Book'}</button>
      </div>
    </div>
  )
}

/* ── slot adder (single + bulk) ─────────────────────────── */

function SlotAdder({ trunkShowId, hours, onCancel, onAdded }: {
  trunkShowId: string
  hours: TrunkShowHours[]
  onCancel: () => void
  onAdded: () => void
}) {
  // Default to "All days" — the most common setup is to fill the
  // whole show at 30-minute intervals from each day's open/close
  // hours. Switch to bulk-day or single for per-day customisation.
  const [mode, setMode] = useState<'single' | 'bulk' | 'all'>('all')
  const [date, setDate] = useState(hours[0]?.show_date || '')
  const [start, setStart] = useState('10:00')
  const [end, setEnd] = useState('10:30')
  const [duration, setDuration] = useState(30)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const dateHours = hours.find(h => h.show_date === date)

  async function submitSingle() {
    if (!date || !start || !end || start >= end || busy) return
    setBusy(true); setErr(null)
    try {
      await createSlot(trunkShowId, {
        slot_start: new Date(`${date}T${start}:00`).toISOString(),
        slot_end:   new Date(`${date}T${end}:00`).toISOString(),
      })
      onAdded()
    } catch (e: any) { setErr(e?.message || 'Could not create'); setBusy(false) }
  }

  async function submitBulk() {
    if (!date || !dateHours || busy) return
    setBusy(true); setErr(null)
    try {
      const slots: { slot_start: string; slot_end: string }[] = []
      const baseStart = new Date(`${date}T${dateHours.open_time.slice(0, 5)}:00`)
      const baseEnd   = new Date(`${date}T${dateHours.close_time.slice(0, 5)}:00`)
      for (let t = new Date(baseStart); t < baseEnd; t.setMinutes(t.getMinutes() + duration)) {
        const slotEnd = new Date(t.getTime() + duration * 60_000)
        if (slotEnd > baseEnd) break
        slots.push({ slot_start: t.toISOString(), slot_end: slotEnd.toISOString() })
      }
      if (slots.length === 0) { setErr('No slots fit in that window.'); setBusy(false); return }
      await bulkCreateSlots(trunkShowId, slots)
      onAdded()
    } catch (e: any) { setErr(e?.message || 'Could not bulk-create'); setBusy(false) }
  }

  // Fill every show day with slots at the given duration, using each
  // day's own open/close hours. The most common setup path.
  async function submitAllDays() {
    if (busy || hours.length === 0) return
    setBusy(true); setErr(null)
    try {
      const slots: { slot_start: string; slot_end: string }[] = []
      for (const h of hours) {
        if (!h.open_time || !h.close_time) continue
        const baseStart = new Date(`${h.show_date}T${h.open_time.slice(0, 5)}:00`)
        const baseEnd   = new Date(`${h.show_date}T${h.close_time.slice(0, 5)}:00`)
        for (let t = new Date(baseStart); t < baseEnd; t.setMinutes(t.getMinutes() + duration)) {
          const slotEnd = new Date(t.getTime() + duration * 60_000)
          if (slotEnd > baseEnd) break
          slots.push({ slot_start: t.toISOString(), slot_end: slotEnd.toISOString() })
        }
      }
      if (slots.length === 0) { setErr('No days with hours configured.'); setBusy(false); return }
      await bulkCreateSlots(trunkShowId, slots)
      onAdded()
    } catch (e: any) { setErr(e?.message || 'Could not fill all days'); setBusy(false) }
  }

  return (
    <div style={{ marginTop: 10, padding: 12, background: 'var(--green-pale)', border: '1px dashed var(--green3)', borderRadius: 8 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <button onClick={() => setMode('all')}    className={mode === 'all'    ? 'btn-primary btn-xs' : 'btn-outline btn-xs'}>All days</button>
        <button onClick={() => setMode('bulk')}   className={mode === 'bulk'   ? 'btn-primary btn-xs' : 'btn-outline btn-xs'}>One day</button>
        <button onClick={() => setMode('single')} className={mode === 'single' ? 'btn-primary btn-xs' : 'btn-outline btn-xs'}>Single slot</button>
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', marginBottom: 8 }}>
        {mode !== 'all' && (
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="fl">Date</label>
            <select value={date} onChange={e => setDate(e.target.value)}>
              <option value="">Pick day…</option>
              {hours.map(h => (
                <option key={h.id} value={h.show_date}>
                  {new Date(h.show_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  {' · '}{h.open_time.slice(0,5)}–{h.close_time.slice(0,5)}
                </option>
              ))}
            </select>
          </div>
        )}
        {mode === 'single' ? (
          <>
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="fl">Start</label>
              <TimePicker value={start} onChange={setStart} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="fl">End</label>
              <TimePicker value={end} onChange={setEnd} />
            </div>
          </>
        ) : (
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="fl">Duration (min)</label>
            <input type="number" min={5} max={240} step={5}
              value={duration}
              onChange={e => setDuration(Math.max(5, Math.min(240, parseInt(e.target.value) || 30)))} />
          </div>
        )}
      </div>
      {mode === 'all' && (
        <div style={{ fontSize: 11, color: 'var(--mist)', marginBottom: 6 }}>
          Fills every show day ({hours.length} day{hours.length === 1 ? '' : 's'}) with back-to-back slots at the duration above, using each day's open/close hours.
        </div>
      )}
      {err && <div style={{ color: '#991B1B', fontSize: 12, marginBottom: 6 }}>{err}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onCancel} className="btn-outline btn-sm">Cancel</button>
        <button
          onClick={mode === 'single' ? submitSingle : mode === 'bulk' ? submitBulk : submitAllDays}
          disabled={busy || (mode !== 'all' && !date) || (mode === 'all' && hours.length === 0)}
          className="btn-primary btn-sm"
        >
          {busy ? 'Adding…' :
            mode === 'single' ? 'Add slot' :
            mode === 'bulk' ? `Fill day @ ${duration}m` :
            `Fill all ${hours.length} days @ ${duration}m`}
        </button>
      </div>
    </div>
  )
}
