'use client'

import { useState, useEffect, useRef } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type { Event } from '@/types'

interface Reservation {
  id: string; event_id: string; buyer_id: string; buyer_name: string
  type: 'flight' | 'hotel' | 'rental_car'; vendor: string; confirmation_number: string
  details: any; check_in: string; check_out: string; departure_at: string; arrival_at: string
  amount: number; created_at: string
}

interface Acknowledgment { id: string; event_id: string; buyer_id: string; type: string }

const TYPE_META: Record<string, { label: string; icon: string; color: string; bg: string }> = {
  flight:     { label: 'Flight',     icon: '✈️', color: '#1e3a5f', bg: '#EEF4FF' },
  hotel:      { label: 'Hotel',      icon: '🏨', color: '#4c1d95', bg: '#F5F0FF' },
  rental_car: { label: 'Rental Car', icon: '🚗', color: '#78350f', bg: '#FFF7ED' },
}

export default function MobileTravel() {
  const { events, stores, user } = useApp()
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [acknowledgments, setAcknowledgments] = useState<Acknowledgment[]>([])
  const [loading, setLoading] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [expandedRes, setExpandedRes] = useState<string | null>(null)

  // Default to "my events" — events the user is an assigned buyer on. Persisted.
  const [scope, setScope] = useState<'mine' | 'all'>('mine')
  useEffect(() => {
    if (typeof window === 'undefined') return
    const saved = window.localStorage.getItem('beb-travel-scope')
    if (saved === 'mine' || saved === 'all') setScope(saved)
  }, [])
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('beb-travel-scope', scope)
  }, [scope])

  const sortedAll = [...events].sort((a, b) => b.start_date.localeCompare(a.start_date))
  const sorted = scope === 'mine'
    ? sortedAll.filter(ev => (ev.workers || []).some((w: any) => w.id === user?.id))
    : sortedAll
  const fmt = (ds: string) => new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const fmtShort = (ds: string) => new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const fmtDT = (d: string) => d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'

  useEffect(() => {
    if (selectedEvent) loadData()
  }, [selectedEvent?.id])

  const loadData = async () => {
    if (!selectedEvent) return
    setLoading(true)
    const [{ data: res }, { data: acks }] = await Promise.all([
      supabase.from('travel_reservations').select('*').eq('event_id', selectedEvent.id).order('created_at'),
      supabase.from('travel_acknowledgments').select('*').eq('event_id', selectedEvent.id),
    ])
    setReservations(res || [])
    setAcknowledgments(acks || [])
    setLoading(false)
  }

  const acknowledge = async (type: string) => {
    await supabase.from('travel_acknowledgments').upsert(
      { event_id: selectedEvent!.id, buyer_id: user?.id, type },
      { onConflict: 'event_id,buyer_id,type' }
    )
    loadData()
  }

  const removeAck = async (type: string) => {
    await supabase.from('travel_acknowledgments').delete()
      .eq('event_id', selectedEvent!.id).eq('buyer_id', user?.id).eq('type', type)
    loadData()
  }

  const deleteRes = async (id: string) => {
    if (!confirm('Delete this reservation?')) return
    await supabase.from('travel_reservations').delete().eq('id', id)
    loadData()
  }

  const workers = selectedEvent ? ((selectedEvent.workers || []) as { id: string; name: string }[]) : []

  const getMissingAlerts = () => {
    if (!selectedEvent) return []
    const alerts: any[] = []
    const eventDate = new Date(selectedEvent.start_date + 'T12:00:00')
    const weeksOut = (eventDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 7)

    workers.forEach(w => {
      const hasAck = (type: string) => acknowledgments.some(a => a.buyer_id === w.id && a.type === type)
      const hasRes = (type: string) => reservations.some(r => r.buyer_id === w.id && r.type === type)
      if (!hasRes('flight') && !hasAck('no_flight') && weeksOut < 8)
        alerts.push({ worker: w, type: 'no_flight', message: `${w.name} — No flight booked` })
      if (!hasRes('hotel') && !hasAck('no_hotel') && weeksOut < 4)
        alerts.push({ worker: w, type: 'no_hotel', message: `${w.name} — No hotel booked` })
    })
    const hasAnyCar = reservations.some(r => r.type === 'rental_car')
    const allAckNoCar = workers.length > 0 && workers.every(w => acknowledgments.some(a => a.buyer_id === w.id && a.type === 'no_rental_car'))
    if (!hasAnyCar && !allAckNoCar && workers.length > 0 && weeksOut < 4)
      alerts.push({ worker: { id: 'team', name: 'Team' }, type: 'no_rental_car', message: 'No rental car booked' })
    return alerts
  }

  // Event picker screen
  if (!selectedEvent) {
    return (
      <div style={{ padding: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 900, color: 'var(--ink)', marginBottom: 12 }}>✈️ Travel Share</h2>
        <div style={{ display: 'flex', gap: 4, marginBottom: 14, background: 'var(--cream2)', borderRadius: 10, padding: 4 }}>
          {([['mine', 'My events'], ['all', 'All events']] as const).map(([id, label]) => {
            const sel = scope === id
            return (
              <button key={id} onClick={() => setScope(id)} style={{
                flex: 1, padding: '10px 8px', borderRadius: 7, border: 'none', cursor: 'pointer',
                background: sel ? '#fff' : 'transparent',
                color: sel ? 'var(--green-dark)' : 'var(--mist)',
                fontSize: 13, fontWeight: 700, fontFamily: 'inherit', minHeight: 40,
                boxShadow: sel ? '0 1px 2px rgba(0,0,0,.06)' : 'none',
              }}>{label}</button>
            )
          })}
        </div>
        {sorted.length === 0 && (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--mist)', fontSize: 14 }}>
            {scope === 'mine'
              ? "You're not assigned to any events yet. Switch to All events to see everything."
              : 'No events.'}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sorted.map(ev => {
            const store = stores.find(s => s.id === ev.store_id)
            const resCount = 0 // could fetch counts here
            return (
              <div key={ev.id} onClick={() => setSelectedEvent(ev)}
                style={{ background: 'var(--cream)', borderRadius: 14, padding: '16px', border: '1px solid var(--pearl)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14, boxShadow: '0 2px 6px rgba(0,0,0,.05)' }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--green-pale)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>✈️</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 900, fontSize: 15, color: 'var(--ink)', marginBottom: 2 }}>◆ {ev.store_name}</div>
                  <div style={{ fontSize: 12, color: 'var(--mist)' }}>{store?.city}, {store?.state} · {fmt(ev.start_date)}</div>
                </div>
                <div style={{ color: 'var(--mist)', fontSize: 18 }}>›</div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  const alerts = getMissingAlerts()
  const store = stores.find(s => s.id === selectedEvent.store_id)
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'

  return (
    <div>
      {/* Event header */}
      <div style={{ background: 'var(--sidebar-bg)', padding: '14px 16px' }}>
        <button onClick={() => setSelectedEvent(null)}
          style={{ background: 'rgba(255,255,255,.15)', border: 'none', color: 'rgba(255,255,255,.8)', fontSize: 13, fontWeight: 700, padding: '10px 14px', borderRadius: 99, cursor: 'pointer', marginBottom: 10, minHeight: 40 }}>
          ← All Events
        </button>
        <div style={{ color: '#7EC8A0', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>Travel</div>
        <div style={{ color: '#fff', fontSize: 18, fontWeight: 900, marginTop: 2 }}>◆ {selectedEvent.store_name}</div>
        <div style={{ color: 'rgba(255,255,255,.5)', fontSize: 12, marginTop: 2 }}>{store?.city}, {store?.state} · {fmt(selectedEvent.start_date)}</div>
      </div>

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Missing alerts */}
        {alerts.length > 0 && (
          <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 12, padding: 14 }}>
            <div style={{ fontWeight: 900, fontSize: 13, color: '#92400e', marginBottom: 8 }}>⚠️ Missing Bookings</div>
            {alerts.map((alert, i) => {
              const myAlert = alert.worker.id === user?.id || alert.worker.id === 'team'
              const myAck = acknowledgments.some(a => a.buyer_id === user?.id && a.type === alert.type)
              return (
                <div key={i} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 13, color: '#92400e', marginBottom: 4 }}>{alert.message}</div>
                  {myAlert && !myAck && (
                    <button onClick={() => acknowledge(alert.type)}
                      style={{ fontSize: 13, fontWeight: 700, padding: '8px 14px', borderRadius: 99, border: '1px solid #d97706', background: 'transparent', color: '#92400e', cursor: 'pointer', minHeight: 36 }}>
                      {alert.type === 'no_rental_car' ? "I don't need a car" : "I'll handle it"}
                    </button>
                  )}
                  {myAck && (
                    <button onClick={() => removeAck(alert.type)}
                      style={{ fontSize: 13, padding: '8px 14px', borderRadius: 99, border: '1px solid #d97706', background: 'rgba(0,0,0,.05)', color: '#92400e', cursor: 'pointer', minHeight: 36 }}>
                      ✓ Acknowledged · Undo
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Team overview */}
        {workers.length > 0 && (
          <div style={{ background: 'var(--cream)', borderRadius: 12, padding: 14, border: '1px solid var(--pearl)' }}>
            <div style={{ fontWeight: 900, fontSize: 13, color: 'var(--ink)', marginBottom: 10 }}>Team Status</div>
            {workers.map(w => {
              const hasFlight = reservations.some(r => r.buyer_id === w.id && r.type === 'flight')
              const hasHotel = reservations.some(r => r.buyer_id === w.id && r.type === 'hotel')
              const hasCar = reservations.some(r => r.type === 'rental_car')
              return (
                <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 900, fontSize: 12, flexShrink: 0 }}>
                    {w.name?.charAt(0)}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', flex: 1 }}>{w.name}</div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {[{ has: hasFlight, icon: '✈️' }, { has: hasHotel, icon: '🏨' }, { has: hasCar, icon: '🚗' }].map((item, i) => (
                      <span key={i} style={{ fontSize: 12, padding: '2px 6px', borderRadius: 6, background: item.has ? 'var(--green-pale)' : 'rgba(239,68,68,.08)', color: item.has ? 'var(--green-dark)' : '#dc2626' }}>
                        {item.icon}
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Add reservation button */}
        <button onClick={() => setShowAdd(true)}
          style={{ width: '100%', padding: '14px', borderRadius: 12, border: 'none', background: 'var(--sidebar-bg)', color: '#fff', fontWeight: 900, fontSize: 15, cursor: 'pointer' }}>
          + Add Reservation
        </button>

        {/* Reservations */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--mist)' }}>Loading…</div>
        ) : reservations.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 32, color: 'var(--mist)', background: 'var(--cream)', borderRadius: 12, border: '1px solid var(--pearl)' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🗓</div>
            <div style={{ fontWeight: 700 }}>No reservations yet</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>Forward confirmation emails to travel@bebllp.com</div>
          </div>
        ) : (
          reservations.map(res => {
            const meta = TYPE_META[res.type] || TYPE_META.flight
            const expanded = expandedRes === res.id
            return (
              <div key={res.id} style={{ background: 'var(--cream)', borderRadius: 14, overflow: 'hidden', border: '1px solid var(--pearl)', boxShadow: '0 2px 6px rgba(0,0,0,.05)' }}>
                <div onClick={() => setExpandedRes(expanded ? null : res.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', cursor: 'pointer' }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: meta.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>
                    {meta.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 900, fontSize: 15, color: 'var(--ink)' }}>{res.vendor || meta.label}</div>
                    <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 2 }}>
                      {res.buyer_name}
                      {res.confirmation_number && ` · ${res.confirmation_number}`}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 1 }}>
                      {res.type === 'flight' && res.departure_at && fmtDT(res.departure_at)}
                      {res.type === 'hotel' && res.check_in && `${fmtShort(res.check_in)} – ${fmtShort(res.check_out)}`}
                      {res.type === 'rental_car' && res.check_in && `Pick up ${fmtShort(res.check_in)}`}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    {res.amount > 0 && <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)' }}>${res.amount.toLocaleString()}</div>}
                    <div style={{ color: 'var(--mist)', fontSize: 16 }}>{expanded ? '▲' : '▼'}</div>
                  </div>
                </div>

                {expanded && (
                  <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--cream2)' }}>
                    <div style={{ paddingTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                      {res.type === 'flight' && <>
                        {res.details?.flight_number && <MobileDetail label="Flight" value={res.details.flight_number} />}
                        {res.details?.from && <MobileDetail label="From" value={res.details.from} />}
                        {res.details?.to && <MobileDetail label="To" value={res.details.to} />}
                        {res.departure_at && <MobileDetail label="Departs" value={fmtDT(res.departure_at)} />}
                        {res.details?.seat && <MobileDetail label="Seat" value={res.details.seat} />}
                      </>}
                      {res.type === 'hotel' && <>
                        {res.details?.address && <MobileDetail label="Address" value={res.details.address} />}
                        {res.check_in && <MobileDetail label="Check-in" value={fmtShort(res.check_in)} />}
                        {res.check_out && <MobileDetail label="Check-out" value={fmtShort(res.check_out)} />}
                        {res.details?.room_type && <MobileDetail label="Room" value={res.details.room_type} />}
                      </>}
                      {res.type === 'rental_car' && <>
                        {res.details?.car_class && <MobileDetail label="Car Class" value={res.details.car_class} />}
                        {res.details?.pickup_location && <MobileDetail label="Pick-up" value={res.details.pickup_location} />}
                        {res.check_in && <MobileDetail label="Pick-up Date" value={fmtShort(res.check_in)} />}
                        {res.check_out && <MobileDetail label="Return" value={fmtShort(res.check_out)} />}
                      </>}
                    </div>
                    {(res.buyer_id === user?.id || isAdmin) && (
                      <button onClick={() => deleteRes(res.id)}
                        style={{ fontSize: 13, fontWeight: 700, padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(220,38,38,.3)', background: 'rgba(220,38,38,.06)', color: '#dc2626', cursor: 'pointer' }}>
                        Delete
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Add modal */}
      {showAdd && (
        <MobileAddReservation
          eventId={selectedEvent.id}
          user={user}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); loadData() }}
        />
      )}
    </div>
  )
}

function MobileDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--mist)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{value}</div>
    </div>
  )
}

function MobileAddReservation({ eventId, user, onClose, onSaved }: any) {
  const [type, setType] = useState<'flight' | 'hotel' | 'rental_car'>('flight')
  const [form, setForm] = useState({
    vendor: '', confirmation_number: '', amount: '',
    departure_at: '', arrival_at: '', check_in: '', check_out: '',
    flight_number: '', from: '', to: '', seat: '',
    address: '', room_type: '', car_class: '', pickup_location: '',
  })
  const [saving, setSaving] = useState(false)
  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [k]: e.target.value }))

  const save = async () => {
    setSaving(true)
    const details: any = {}
    if (type === 'flight') { details.flight_number = form.flight_number; details.from = form.from; details.to = form.to; details.seat = form.seat }
    if (type === 'hotel') { details.address = form.address; details.room_type = form.room_type }
    if (type === 'rental_car') { details.car_class = form.car_class; details.pickup_location = form.pickup_location }
    const { error } = await supabase.from('travel_reservations').insert({
      event_id: eventId, buyer_id: user?.id, buyer_name: user?.name,
      type, vendor: form.vendor, confirmation_number: form.confirmation_number,
      amount: parseFloat(form.amount) || 0, details,
      departure_at: form.departure_at || null, arrival_at: form.arrival_at || null,
      check_in: form.check_in || null, check_out: form.check_out || null,
    })
    if (error) { alert('Error: ' + error.message); setSaving(false); return }
    onSaved()
  }

  const inp = (label: string, key: keyof typeof form, type = 'text', placeholder = '') => (
    <div key={key}>
      <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--mist)', display: 'block', marginBottom: 4 }}>{label}</label>
      <input type={type} value={form[key]} onChange={f(key)} placeholder={placeholder} style={{ width: '100%', fontSize: 15, padding: '10px 12px' }} />
    </div>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 1000, overflowY: 'auto' }}>
      <div style={{ background: 'var(--cream)', minHeight: '100vh' }}>
        <div style={{ background: 'var(--sidebar-bg)', padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ color: '#fff', fontWeight: 900, fontSize: 17 }}>Add Reservation</div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff', width: 44, height: 44, borderRadius: '50%', fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Type tabs */}
          <div style={{ display: 'flex', gap: 8 }}>
            {(['flight', 'hotel', 'rental_car'] as const).map(t => (
              <button key={t} onClick={() => setType(t)} style={{
                flex: 1, padding: '10px 4px', borderRadius: 10,
                border: `2px solid ${type === t ? 'var(--green)' : 'var(--pearl)'}`,
                background: type === t ? 'var(--green-pale)' : 'var(--cream2)',
                fontWeight: 700, fontSize: 13,
                color: type === t ? 'var(--green-dark)' : 'var(--ash)', cursor: 'pointer',
              }}>
                {TYPE_META[t].icon} {TYPE_META[t].label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {inp('Vendor', 'vendor')}
            {inp('Confirmation #', 'confirmation_number')}
            {inp('Amount ($)', 'amount', 'number')}
            {type === 'flight' && <>{inp('Flight #', 'flight_number', 'text', 'AA 1234')}{inp('From', 'from', 'text', 'ORD')}{inp('To', 'to', 'text', 'OMA')}{inp('Seat', 'seat')}{inp('Departure', 'departure_at', 'datetime-local')}{inp('Arrival', 'arrival_at', 'datetime-local')}</>}
            {type === 'hotel' && <>{inp('Address', 'address')}{inp('Room Type', 'room_type')}{inp('Check-in', 'check_in', 'date')}{inp('Check-out', 'check_out', 'date')}</>}
            {type === 'rental_car' && <>{inp('Car Class', 'car_class', 'text', 'Compact SUV')}{inp('Pick-up Location', 'pickup_location')}{inp('Pick-up Date', 'check_in', 'date')}{inp('Return Date', 'check_out', 'date')}</>}
          </div>
          <button onClick={save} disabled={saving}
            style={{ width: '100%', padding: 16, borderRadius: 12, border: 'none', background: 'var(--sidebar-bg)', color: '#fff', fontWeight: 900, fontSize: 16, cursor: 'pointer' }}>
            {saving ? 'Saving…' : 'Add Reservation'}
          </button>
        </div>
      </div>
    </div>
  )
}
