'use client'

// Internal booth-appointment panel for a trade show. Lets staff
// create slots, manually book them, mark statuses, generate
// magic-link booking URLs to share with prospects.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import {
  listAppointments, createSlot, bulkCreateSlots, bookSlot, setSlotStatus, setAssignedStaff,
  deleteSlot, generateBookingToken,
  type TradeShowAppointment, type TradeShowAppointmentStatus,
} from '@/lib/sales/tradeShowAppointments'
import { listStaff, type TradeShowStaffer } from '@/lib/sales/tradeShowStaff'
import type { TradeShowHours } from '@/lib/sales/tradeshows'
import DatePicker from '@/components/ui/DatePicker'
import TimePicker from '@/components/ui/TimePicker'

const STATUS_LABEL: Record<TradeShowAppointmentStatus, string> = {
  available: 'Open', booked: 'Booked', completed: 'Done', cancelled: 'Cancelled', no_show: 'No-show',
}
const STATUS_COLOR: Record<TradeShowAppointmentStatus, { bg: string; fg: string }> = {
  available: { bg: '#E5E7EB', fg: '#374151' },
  booked:    { bg: '#DBEAFE', fg: '#1E40AF' },
  completed: { bg: '#D1FAE5', fg: '#065F46' },
  cancelled: { bg: '#FEE2E2', fg: '#991B1B' },
  no_show:   { bg: '#FEF3C7', fg: '#92400E' },
}

interface Props {
  tradeShowId: string
  startDate: string
  endDate: string
  canWrite: boolean
  hours?: TradeShowHours[]
}

export default function TradeShowAppointmentsPanel({ tradeShowId, startDate, endDate, canWrite, hours = [] }: Props) {
  const { users } = useApp()
  const [rows, setRows] = useState<TradeShowAppointment[]>([])
  const [staff, setStaff] = useState<TradeShowStaffer[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [adderOpen, setAdderOpen] = useState(false)
  const [bookingFor, setBookingFor] = useState<string | null>(null)
  const [tokenUrl, setTokenUrl] = useState<string | null>(null)
  const [tokenBusy, setTokenBusy] = useState(false)

  async function reload() {
    setError(null)
    try {
      const [r, s] = await Promise.all([
        listAppointments(tradeShowId),
        listStaff(tradeShowId),
      ])
      setRows(r); setStaff(s)
    }
    catch (err: any) { setError(err?.message || 'Failed to load') }
    setLoaded(true)
  }
  useEffect(() => { void reload() /* eslint-disable-next-line */ }, [tradeShowId])

  const usersById = useMemo(() => new Map(users.map(u => [u.id, u])), [users])
  const eligibleStaff = useMemo(() => users
    .filter(u => u.active !== false)
    .filter(u => u.role !== 'pending' && (u.role !== 'buyer' || u.is_partner))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
  [users])

  const grouped = useMemo(() => {
    // Group by show-date (YYYY-MM-DD).
    const m: Record<string, TradeShowAppointment[]> = {}
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
      const { url } = await generateBookingToken(tradeShowId)
      setTokenUrl(url)
    } catch (err: any) {
      setError(err?.message || 'Could not generate link')
    }
    setTokenBusy(false)
  }
  async function handleCopyToken() {
    if (!tokenUrl) return
    try { await navigator.clipboard.writeText(tokenUrl) } catch {}
  }

  async function handleStatus(id: string, status: TradeShowAppointmentStatus) {
    try {
      await setSlotStatus(id, status)
      setRows(p => p.map(r => r.id === id ? { ...r, status } : r))
    } catch (err: any) {
      alert(err?.message || 'Could not update status')
    }
  }

  async function handleAssign(id: string, staffId: string) {
    try {
      await setAssignedStaff(id, staffId || null)
      setRows(p => p.map(r => r.id === id ? { ...r, assigned_staff_id: staffId || null } : r))
    } catch (err: any) {
      alert(err?.message || 'Could not assign staffer')
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this slot?')) return
    try {
      await deleteSlot(id)
      setRows(p => p.filter(r => r.id !== id))
    } catch (err: any) {
      alert(err?.message || 'Could not delete')
    }
  }

  return (
    <div className="card" style={{ padding: 20, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>📅 Booth Appointments</div>
          <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 2 }}>
            Slots staff create within the show window. Book manually or share the magic link.
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
          borderRadius: 8, padding: 10, marginBottom: 10,
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--green-dark)' }}>📎 Share:</span>
          <code style={{ flex: 1, minWidth: 180, fontSize: 11, color: 'var(--ink)', overflow: 'auto', whiteSpace: 'nowrap' }}>{tokenUrl}</code>
          <button onClick={handleCopyToken} className="btn-outline btn-xs">Copy</button>
        </div>
      )}

      {error && (
        <div style={{ background: '#FEE2E2', color: '#991B1B', padding: '8px 10px', borderRadius: 6, fontSize: 13, marginBottom: 10 }}>{error}</div>
      )}

      {!loaded ? (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--mist)', fontSize: 13 }}>Loading…</div>
      ) : grouped.length === 0 ? (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--mist)', fontSize: 13, fontStyle: 'italic' }}>
          No slots yet.{canWrite && ' Click "+ Add slot" below.'}
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
                    eligibleStaff={eligibleStaff}
                    staffName={slot.assigned_staff_id ? usersById.get(slot.assigned_staff_id)?.name || null : null}
                    bookingOpen={bookingFor === slot.id}
                    onBookClick={() => setBookingFor(slot.id)}
                    onBookCancel={() => setBookingFor(null)}
                    onBooked={() => { setBookingFor(null); void reload() }}
                    onStatus={(s) => handleStatus(slot.id, s)}
                    onAssign={(id) => handleAssign(slot.id, id)}
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
          <AddSlotRow
            tradeShowId={tradeShowId}
            startDate={startDate}
            endDate={endDate}
            eligibleStaff={eligibleStaff}
            hours={hours}
            staff={staff}
            onCancel={() => setAdderOpen(false)}
            onCreated={(slot) => { setRows(p => [...p, slot].sort((a, b) => a.slot_start.localeCompare(b.slot_start))); setAdderOpen(false) }}
            onBulkAdded={() => { void reload(); setAdderOpen(false) }}
          />
        ) : (
          <button onClick={() => setAdderOpen(true)} className="btn-outline btn-sm" style={{ marginTop: 10 }}>
            + Add slot
          </button>
        )
      )}
    </div>
  )
}

/* ── single slot row ─────────────────────────────────────── */

function SlotRow({
  slot, canWrite, eligibleStaff, staffName,
  bookingOpen, onBookClick, onBookCancel, onBooked,
  onStatus, onAssign, onDelete,
}: {
  slot: TradeShowAppointment
  canWrite: boolean
  eligibleStaff: any[]
  staffName: string | null
  bookingOpen: boolean
  onBookClick: () => void
  onBookCancel: () => void
  onBooked: () => void
  onStatus: (s: TradeShowAppointmentStatus) => void
  onAssign: (id: string) => void
  onDelete: () => void
}) {
  const sc = STATUS_COLOR[slot.status]
  const t = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

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
        {(slot.booked_by_external_name || slot.booked_by_lead_id) && (
          <span style={{ fontSize: 12, color: 'var(--ash)' }}>
            {slot.booked_by_external_name || '(linked lead)'}
            {slot.booked_by_external_email && <span style={{ color: 'var(--mist)', marginLeft: 6 }}>· {slot.booked_by_external_email}</span>}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {staffName && <span style={{ fontSize: 11, color: 'var(--mist)' }}>{staffName}</span>}
        {canWrite && (
          <>
            {slot.status === 'available' && (
              <button onClick={onBookClick} className="btn-outline btn-xs">Book</button>
            )}
            {slot.status === 'booked' && (
              <>
                <button onClick={() => onStatus('completed')} className="btn-outline btn-xs">Mark done</button>
                <button onClick={() => onStatus('no_show')} className="btn-outline btn-xs">No-show</button>
                <button onClick={() => onStatus('cancelled')} className="btn-outline btn-xs">Cancel</button>
              </>
            )}
            {slot.status !== 'available' && (
              <button onClick={() => onStatus('available')} className="btn-outline btn-xs" title="Reset to open">↺</button>
            )}
            <select
              value={slot.assigned_staff_id || ''}
              onChange={e => onAssign(e.target.value)}
              style={{ width: 'auto', minWidth: 110, fontSize: 11 }}
            >
              <option value="">No staffer</option>
              {eligibleStaff.map(u => (
                <option key={u.id} value={u.id}>{u.name?.split(' ')[0] || u.name}</option>
              ))}
            </select>
            {slot.status === 'available' && (
              <button onClick={onDelete} aria-label="Delete slot" title="Delete slot"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--mist)', fontSize: 14 }}>×</button>
            )}
          </>
        )}
      </div>
      {bookingOpen && (
        <BookingForm
          slotId={slot.id}
          onCancel={onBookCancel}
          onBooked={onBooked}
        />
      )}
    </div>
  )
}

/* ── manual booking form ─────────────────────────────────── */

function BookingForm({ slotId, onCancel, onBooked }: {
  slotId: string
  onCancel: () => void
  onBooked: () => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    if (!name.trim() || busy) return
    setBusy(true); setErr(null)
    try {
      await bookSlot(slotId, {
        booked_by_external_name:  name,
        booked_by_external_email: email,
        booked_by_external_phone: phone,
        notes,
      })
      onBooked()
    } catch (e: any) {
      setErr(e?.message || 'Could not book')
      setBusy(false)
    }
  }

  return (
    <div style={{ background: 'var(--green-pale)', border: '1px dashed var(--green3)', borderRadius: 6, padding: 10 }}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2" style={{ marginBottom: 6 }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Name *" autoFocus />
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" type="email" />
        <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone" type="tel" />
        <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes" />
      </div>
      {err && <div style={{ color: '#991B1B', fontSize: 12, marginBottom: 6 }}>{err}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onCancel} className="btn-outline btn-xs">Cancel</button>
        <button onClick={submit} disabled={busy || !name.trim()} className="btn-primary btn-xs">{busy ? 'Booking…' : 'Book'}</button>
      </div>
    </div>
  )
}

/* ── add-slot row ────────────────────────────────────────── */

function AddSlotRow({
  tradeShowId, startDate, endDate, eligibleStaff, hours, staff, onCancel, onCreated, onBulkAdded,
}: {
  tradeShowId: string
  startDate: string
  endDate: string
  eligibleStaff: any[]
  hours: TradeShowHours[]
  staff: TradeShowStaffer[]
  onCancel: () => void
  onCreated: (slot: TradeShowAppointment) => void
  onBulkAdded: () => void
}) {
  // Default to "All days" mode — fills every day's hours with
  // 30-min slots per assigned trunk rep working that day.
  const [mode, setMode] = useState<'single' | 'all'>('all')
  const [date, setDate] = useState(startDate || '')
  const [start, setStart] = useState('10:00')
  const [end, setEnd] = useState('10:30')
  const [staffId, setStaffId] = useState<string>('')
  const [duration, setDuration] = useState(30)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const valid = !!date && !!start && !!end && start < end
                  && date >= startDate && date <= endDate

  async function submit() {
    if (!valid || busy) return
    setBusy(true); setErr(null)
    try {
      const slotStart = new Date(`${date}T${start}:00`).toISOString()
      const slotEnd   = new Date(`${date}T${end}:00`).toISOString()
      const created = await createSlot(tradeShowId, {
        slot_start: slotStart,
        slot_end:   slotEnd,
        assigned_staff_id: staffId || null,
      })
      onCreated(created)
    } catch (e: any) {
      setErr(e?.message || 'Could not create')
      setBusy(false)
    }
  }

  // For each show day with hours configured, for each assigned rep
  // whose assigned_dates includes that day, mint back-to-back
  // duration-minute slots from open to close.
  async function submitAll() {
    if (busy || hours.length === 0) return
    setBusy(true); setErr(null)
    try {
      const drafts: { slot_start: string; slot_end: string; assigned_staff_id: string | null }[] = []
      for (const h of hours) {
        const repsThatDay = staff.filter(s => (s.assigned_dates || []).includes(h.show_date))
        const targets = repsThatDay.length > 0 ? repsThatDay.map(r => r.user_id) : [null as string | null]
        const baseStart = new Date(`${h.show_date}T${h.open_time.slice(0, 5)}:00`)
        const baseEnd   = new Date(`${h.show_date}T${h.close_time.slice(0, 5)}:00`)
        for (const repId of targets) {
          for (let t = new Date(baseStart); t < baseEnd; t.setMinutes(t.getMinutes() + duration)) {
            const slotEnd = new Date(t.getTime() + duration * 60_000)
            if (slotEnd > baseEnd) break
            drafts.push({
              slot_start: t.toISOString(),
              slot_end:   slotEnd.toISOString(),
              assigned_staff_id: repId,
            })
          }
        }
      }
      if (drafts.length === 0) { setErr('No hours configured. Set at least one show day in the Show Hours card first.'); setBusy(false); return }
      await bulkCreateSlots(tradeShowId, drafts)
      onBulkAdded()
    } catch (e: any) { setErr(e?.message || 'Could not bulk-create'); setBusy(false) }
  }

  const repCount = staff.length
  const dayCount = hours.length
  const repDayCount = hours.reduce((acc, h) => acc + Math.max(staff.filter(s => (s.assigned_dates || []).includes(h.show_date)).length, 1), 0)

  return (
    <div style={{
      marginTop: 10, padding: 12,
      background: 'var(--green-pale)', border: '1px dashed var(--green3)',
      borderRadius: 8,
    }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <button onClick={() => setMode('all')}    className={mode === 'all'    ? 'btn-primary btn-xs' : 'btn-outline btn-xs'}>All days × reps</button>
        <button onClick={() => setMode('single')} className={mode === 'single' ? 'btn-primary btn-xs' : 'btn-outline btn-xs'}>Single slot</button>
      </div>
      {mode === 'all' ? (
        <>
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', marginBottom: 8 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="fl">Duration (min)</label>
              <input type="number" min={5} max={240} step={5}
                value={duration}
                onChange={e => setDuration(Math.max(5, Math.min(240, parseInt(e.target.value) || 30)))} />
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--mist)', marginBottom: 6 }}>
            {dayCount === 0
              ? 'Set show hours first (no days configured).'
              : repCount === 0
                ? `Will fill ${dayCount} day${dayCount === 1 ? '' : 's'} with unassigned slots — assign staff in the Staff card to break out per-rep slots.`
                : `Will fill ${dayCount} day${dayCount === 1 ? '' : 's'} with ${repCount} rep${repCount === 1 ? '' : 's'} (${repDayCount} rep-day combinations) at ${duration}-minute intervals.`}
          </div>
        </>
      ) : (
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', marginBottom: 8 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="fl">Date</label>
            <DatePicker value={date} min={startDate} max={endDate} onChange={setDate} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="fl">Start</label>
            <TimePicker value={start} onChange={setStart} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="fl">End</label>
            <TimePicker value={end} onChange={setEnd} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="fl">Staffer (optional)</label>
            <select value={staffId} onChange={e => setStaffId(e.target.value)}>
              <option value="">No staffer</option>
              {eligibleStaff.map(u => (
                <option key={u.id} value={u.id}>{u.name?.split(' ')[0] || u.name}</option>
              ))}
            </select>
          </div>
        </div>
      )}
      {err && <div style={{ color: '#991B1B', fontSize: 12, marginBottom: 6 }}>{err}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onCancel} className="btn-outline btn-sm">Cancel</button>
        <button onClick={mode === 'single' ? submit : submitAll}
          disabled={busy || (mode === 'single' ? !valid : dayCount === 0)}
          className="btn-primary btn-sm">
          {busy ? 'Adding…' :
            mode === 'single' ? 'Add slot' :
            `Fill ${dayCount} day${dayCount === 1 ? '' : 's'} @ ${duration}m`}
        </button>
      </div>
    </div>
  )
}
