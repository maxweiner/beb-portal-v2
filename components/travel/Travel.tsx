'use client'

import { useState, useEffect, useRef } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type { Event } from '@/types'

interface TravelFolder { id: string; event_id: string; name: string; sort_order: number }
interface TravelItem { id: string; folder_id: string; event_id: string; type: 'note' | 'image'; content: string; image_url: string; file_name: string }
interface Reservation {
  id: string; event_id: string; buyer_id: string; buyer_name: string
  type: 'flight' | 'hotel' | 'rental_car'; vendor: string; confirmation_number: string
  details: any; check_in: string; check_out: string; departure_at: string; arrival_at: string
  amount: number; created_at: string
}
interface Acknowledgment { id: string; event_id: string; buyer_id: string; type: string }

const TYPE_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  flight:     { label: 'Flight',      icon: '✈️',  color: '#1e3a5f' },
  hotel:      { label: 'Hotel',       icon: '🏨',  color: '#4c1d95' },
  rental_car: { label: 'Rental Car',  icon: '🚗',  color: '#78350f' },
}

export default function Travel() {
  const { events, stores, user } = useApp()
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'reservations' | 'folders'>('reservations')
  // Default to "my events" — what most users want to see; persists across sessions.
  const [scope, setScope] = useState<'mine' | 'all'>('mine')
  const [showPast, setShowPast] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const saved = window.localStorage.getItem('beb-travel-scope')
    if (saved === 'mine' || saved === 'all') setScope(saved)
  }, [])
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('beb-travel-scope', scope)
  }, [scope])

  const todayStr = new Date().toISOString().slice(0, 10)
  // An event has fully passed if today is after its last day. Events run
  // 3 days from start_date (matches the convention used elsewhere).
  const isPast = (ev: Event) => {
    const last = new Date(ev.start_date + 'T12:00:00')
    last.setDate(last.getDate() + 2)
    return last.toISOString().slice(0, 10) < todayStr
  }

  const sorted = [...events].sort((a, b) => b.start_date.localeCompare(a.start_date))
  const scoped = scope === 'mine'
    ? sorted.filter(ev => (ev.workers || []).some((w: any) => w.id === user?.id))
    : sorted
  const pastCount = scoped.filter(isPast).length
  const visible = showPast ? scoped : scoped.filter(ev => !isPast(ev))
  const filtered = visible.filter(ev => ev.store_name?.toLowerCase().includes(search.toLowerCase()))
  const fmt = (ds: string) => new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 60px)', overflow: 'hidden' }}>
      {/* Event sidebar */}
      <div style={{ width: 260, flexShrink: 0, borderRight: '1px solid var(--pearl)', display: 'flex', flexDirection: 'column', background: 'var(--cream)' }}>
        <div style={{ padding: '16px 16px 8px', borderBottom: '1px solid var(--pearl)' }}>
          <div style={{ fontWeight: 900, fontSize: 16, color: 'var(--ink)', marginBottom: 10 }}>✈️ Travel Share</div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 8, background: 'var(--cream2)', borderRadius: 8, padding: 3 }}>
            {([['mine', 'My events'], ['all', 'All events']] as const).map(([id, label]) => {
              const sel = scope === id
              return (
                <button key={id} onClick={() => setScope(id)} style={{
                  flex: 1, padding: '5px 8px', borderRadius: 6, border: 'none', cursor: 'pointer',
                  background: sel ? '#fff' : 'transparent',
                  color: sel ? 'var(--green-dark)' : 'var(--mist)',
                  fontSize: 11, fontWeight: 700, fontFamily: 'inherit',
                  boxShadow: sel ? '0 1px 2px rgba(0,0,0,.06)' : 'none',
                }}>{label}</button>
              )
            })}
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search events…" style={{ width: '100%', fontSize: 13 }} />
          {pastCount > 0 && (
            <button onClick={() => setShowPast(p => !p)} style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginTop: 8,
              color: 'var(--mist)', fontSize: 11, fontWeight: 600, textDecoration: 'underline',
              fontFamily: 'inherit', textAlign: 'left',
            }}>
              {showPast
                ? `Hide ${pastCount} past event${pastCount === 1 ? '' : 's'}`
                : `Show ${pastCount} past event${pastCount === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.map(ev => {
            const store = stores.find(s => s.id === ev.store_id)
            const sel = selectedEvent?.id === ev.id
            return (
              <div key={ev.id} onClick={() => setSelectedEvent(ev)}
                style={{
                  padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid var(--cream2)',
                  background: sel ? 'var(--green-pale)' : 'transparent',
                  borderLeft: sel ? '3px solid var(--green)' : '3px solid transparent',
                }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: sel ? 'var(--green-dark)' : 'var(--ink)' }}>◆ {ev.store_name}</div>
                <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 2 }}>{store?.city}, {store?.state} · {fmt(ev.start_date)}</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, overflowY: 'auto', background: 'var(--cream2)' }}>
        {!selectedEvent ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--mist)' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✈️</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Travel Share</div>
            <div style={{ fontSize: 14 }}>Select an event to view travel details</div>
          </div>
        ) : (
          <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
            {/* Header */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--mist)', marginBottom: 4 }}>Travel</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)' }}>◆ {selectedEvent.store_name}</div>
              <div style={{ fontSize: 13, color: 'var(--mist)', marginTop: 2 }}>{selectedEvent.start_date}</div>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 4, background: 'var(--cream)', padding: 4, borderRadius: 'var(--r)', border: '1px solid var(--pearl)', width: 'fit-content', marginBottom: 20 }}>
              {([['reservations', '🗓 Reservations'], ['folders', '📁 Notes & Files']] as const).map(([id, label]) => (
                <button key={id} onClick={() => setTab(id)} style={{
                  padding: '7px 16px', borderRadius: 'calc(var(--r) - 2px)', border: 'none', cursor: 'pointer',
                  background: tab === id ? 'var(--sidebar-bg)' : 'transparent',
                  color: tab === id ? '#fff' : 'var(--ash)', fontWeight: 700, fontSize: 13,
                }}>{label}</button>
              ))}
            </div>

            {tab === 'reservations' && <ReservationsView ev={selectedEvent} user={user} />}
            {tab === 'folders' && <FoldersView ev={selectedEvent} user={user} />}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── RESERVATIONS VIEW ── */
function ReservationsView({ ev, user }: { ev: Event; user: any }) {
  const { users } = useApp()
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [acknowledgments, setAcknowledgments] = useState<Acknowledgment[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [filterType, setFilterType] = useState<string>('all')
  const workers = (ev.workers || []) as { id: string; name: string }[]

  useEffect(() => { loadData() }, [ev.id])

  const loadData = async () => {
    setLoading(true)
    const [{ data: res }, { data: acks }] = await Promise.all([
      supabase.from('travel_reservations').select('*').eq('event_id', ev.id).order('created_at'),
      supabase.from('travel_acknowledgments').select('*').eq('event_id', ev.id),
    ])
    setReservations(res || [])
    setAcknowledgments(acks || [])
    setLoading(false)
  }

  const acknowledge = async (type: string) => {
    await supabase.from('travel_acknowledgments').upsert({
      event_id: ev.id, buyer_id: user?.id, type,
    }, { onConflict: 'event_id,buyer_id,type' })
    loadData()
  }

  const removeAck = async (type: string) => {
    await supabase.from('travel_acknowledgments').delete()
      .eq('event_id', ev.id).eq('buyer_id', user?.id).eq('type', type)
    loadData()
  }

  const deleteReservation = async (id: string) => {
    if (!confirm('Delete this reservation?')) return
    await supabase.from('travel_reservations').delete().eq('id', id)
    loadData()
  }

  // Missing booking alerts
  const getMissingAlerts = () => {
    const alerts: { worker: { id: string; name: string }; type: string; message: string }[] = []
    const eventDate = new Date(ev.start_date + 'T12:00:00')
    const weeksOut = (eventDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 7)

    workers.forEach(w => {
      const hasAck = (type: string) => acknowledgments.some(a => a.buyer_id === w.id && a.type === type)
      const hasRes = (type: string) => reservations.some(r => r.buyer_id === w.id && r.type === type)

      if (!hasRes('flight') && !hasAck('no_flight') && weeksOut < 8)
        alerts.push({ worker: w, type: 'no_flight', message: `No flight booked` })
      if (!hasRes('hotel') && !hasAck('no_hotel') && weeksOut < 4)
        alerts.push({ worker: w, type: 'no_hotel', message: `No hotel booked` })
    })

    // Rental car — at least one needed for the whole team
    const hasAnyCar = reservations.some(r => r.type === 'rental_car')
    const allAckNoCar = workers.length > 0 && workers.every(w => acknowledgments.some(a => a.buyer_id === w.id && a.type === 'no_rental_car'))
    if (!hasAnyCar && !allAckNoCar && workers.length > 0 && weeksOut < 4)
      alerts.push({ worker: { id: 'team', name: 'Team' }, type: 'no_rental_car', message: 'No rental car booked for this event' })

    return alerts
  }

  const alerts = getMissingAlerts()
  const filtered = filterType === 'all' ? reservations : reservations.filter(r => r.type === filterType)

  const totalCost = reservations.reduce((s, r) => s + (r.amount || 0), 0)

  if (loading) return <div style={{ color: 'var(--mist)', padding: 20 }}>Loading…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Missing booking alerts */}
      {alerts.length > 0 && (
        <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 'var(--r2)', padding: 16 }}>
          <div style={{ fontWeight: 900, fontSize: 14, color: '#92400e', marginBottom: 10 }}>⚠️ Missing Bookings</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {alerts.map((alert, i) => {
              const myAlert = alert.worker.id === user?.id || alert.worker.id === 'team'
              const myAck = acknowledgments.some(a => a.buyer_id === user?.id && a.type === alert.type)
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 13, color: '#92400e' }}>
                    <strong>{alert.worker.name}</strong> — {alert.message}
                  </div>
                  {myAlert && !myAck && (
                    <button onClick={() => acknowledge(alert.type)}
                      style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 99, border: '1px solid #d97706', background: 'transparent', color: '#92400e', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      {alert.type === 'no_rental_car' ? "I don't need a car" : "I'll handle it"}
                    </button>
                  )}
                  {myAck && (
                    <button onClick={() => removeAck(alert.type)}
                      style={{ fontSize: 11, padding: '4px 10px', borderRadius: 99, border: '1px solid #d97706', background: 'rgba(0,0,0,.05)', color: '#92400e', cursor: 'pointer' }}>
                      ✓ Acknowledged · Undo
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Team overview */}
      {workers.length > 0 && (
        <div className="card" style={{ margin: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div className="card-title" style={{ margin: 0 }}>Team Travel Overview</div>
            {totalCost > 0 && <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)' }}>Total: ${totalCost.toLocaleString()}</div>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {workers.map(w => {
              const wRes = reservations.filter(r => r.buyer_id === w.id)
              const hasFlight = wRes.some(r => r.type === 'flight')
              const hasHotel = wRes.some(r => r.type === 'hotel')
              const hasCar = reservations.some(r => r.type === 'rental_car') // team-wide
              const ackNoCar = acknowledgments.some(a => a.buyer_id === w.id && a.type === 'no_rental_car')
              return (
                <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'var(--cream2)', borderRadius: 'var(--r)', flexWrap: 'wrap' }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)', minWidth: 120 }}>👤 {w.name}</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {[
                      { type: 'flight', has: hasFlight, icon: '✈️' },
                      { type: 'hotel', has: hasHotel, icon: '🏨' },
                      { type: 'rental_car', has: hasCar || ackNoCar, icon: '🚗' },
                    ].map(item => (
                      <span key={item.type} style={{
                        fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 99,
                        background: item.has ? 'var(--green-pale)' : 'rgba(239,68,68,.08)',
                        color: item.has ? 'var(--green-dark)' : '#dc2626',
                        border: `1px solid ${item.has ? 'var(--green3)' : 'rgba(239,68,68,.2)'}`,
                      }}>
                        {item.icon} {item.has ? '✓' : '✗'}
                      </span>
                    ))}
                  </div>
                  <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--mist)' }}>
                    {wRes.length} reservation{wRes.length !== 1 ? 's' : ''} · ${wRes.reduce((s, r) => s + (r.amount || 0), 0).toLocaleString()}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Filter + Add */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, background: 'var(--cream)', padding: 3, borderRadius: 'var(--r)', border: '1px solid var(--pearl)' }}>
          {(['all', 'flight', 'hotel', 'rental_car'] as const).map(t => (
            <button key={t} onClick={() => setFilterType(t)} style={{
              padding: '4px 12px', borderRadius: 'calc(var(--r) - 2px)', border: 'none', cursor: 'pointer',
              background: filterType === t ? 'var(--sidebar-bg)' : 'transparent',
              color: filterType === t ? '#fff' : 'var(--ash)', fontWeight: 700, fontSize: 12,
            }}>
              {t === 'all' ? 'All' : TYPE_LABELS[t].icon + ' ' + TYPE_LABELS[t].label}
            </button>
          ))}
        </div>
        <button className="btn-primary btn-sm" onClick={() => setShowAdd(true)} style={{ marginLeft: 'auto' }}>
          + Add Reservation
        </button>
      </div>

      {/* Reservations list */}
      {filtered.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '40px 0', color: 'var(--mist)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🗓</div>
          <div style={{ fontWeight: 700 }}>No reservations yet</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Add manually or set up email forwarding in Settings</div>
        </div>
      )}

      {filtered.map(res => (
        <ReservationCard key={res.id} res={res} user={user} onDelete={deleteReservation} />
      ))}

      {/* Add modal */}
      {showAdd && (
        <AddReservationModal
          eventId={ev.id}
          user={user}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); loadData() }}
        />
      )}
    </div>
  )
}

/* ── RESERVATION CARD ── */
function ReservationCard({ res, user, onDelete }: { res: Reservation; user: any; onDelete: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const meta = TYPE_LABELS[res.type] || { label: res.type, icon: '📋', color: '#666' }
  const isOwn = res.buyer_id === user?.id
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'

  const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'
  const fmtDateTime = (d: string) => d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'

  return (
    <div style={{ background: 'var(--cream)', borderRadius: 'var(--r2)', overflow: 'hidden', border: '1px solid var(--pearl)', boxShadow: '0 2px 8px rgba(0,0,0,.04)' }}>
      {/* Header */}
      <div onClick={() => setExpanded(!expanded)} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', cursor: 'pointer' }}>
        <div style={{ background: meta.color, borderRadius: 10, width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
          {meta.icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 900, fontSize: 15, color: 'var(--ink)' }}>{res.vendor || meta.label}</div>
            {res.confirmation_number && (
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--cream2)', color: 'var(--mist)', fontFamily: 'monospace' }}>
                {res.confirmation_number}
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 2 }}>
            👤 {res.buyer_name}
            {res.type === 'flight' && res.departure_at && ` · ${fmtDateTime(res.departure_at)}`}
            {res.type === 'hotel' && res.check_in && ` · ${fmtDate(res.check_in)} – ${fmtDate(res.check_out)}`}
            {res.type === 'rental_car' && res.check_in && ` · Pick up ${fmtDate(res.check_in)}`}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {res.amount > 0 && <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--green)' }}>${res.amount.toLocaleString()}</div>}
          <div style={{ color: 'var(--mist)', fontSize: 14 }}>{expanded ? '▲' : '▼'}</div>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div style={{ padding: '0 18px 16px', borderTop: '1px solid var(--cream2)' }}>
          <div style={{ paddingTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {res.type === 'flight' && <>
              {res.details?.flight_number && <Detail label="Flight" value={res.details.flight_number} />}
              {res.details?.from && <Detail label="From" value={res.details.from} />}
              {res.details?.to && <Detail label="To" value={res.details.to} />}
              {res.departure_at && <Detail label="Departs" value={fmtDateTime(res.departure_at)} />}
              {res.arrival_at && <Detail label="Arrives" value={fmtDateTime(res.arrival_at)} />}
              {res.details?.seat && <Detail label="Seat" value={res.details.seat} />}
            </>}
            {res.type === 'hotel' && <>
              {res.details?.address && <Detail label="Address" value={res.details.address} />}
              {res.check_in && <Detail label="Check-in" value={fmtDate(res.check_in)} />}
              {res.check_out && <Detail label="Check-out" value={fmtDate(res.check_out)} />}
              {res.details?.room_type && <Detail label="Room" value={res.details.room_type} />}
            </>}
            {res.type === 'rental_car' && <>
              {res.details?.car_class && <Detail label="Car Class" value={res.details.car_class} />}
              {res.details?.pickup_location && <Detail label="Pick-up" value={res.details.pickup_location} />}
              {res.check_in && <Detail label="Pick-up Date" value={fmtDate(res.check_in)} />}
              {res.check_out && <Detail label="Return Date" value={fmtDate(res.check_out)} />}
            </>}
          </div>
          {(isOwn || isAdmin) && (
            <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
              <button onClick={() => onDelete(res.id)} className="btn-danger btn-sm">Delete</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--mist)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{value}</div>
    </div>
  )
}

/* ── ADD RESERVATION MODAL ── */
function AddReservationModal({ eventId, user, onClose, onSaved }: {
  eventId: string; user: any; onClose: () => void; onSaved: () => void
}) {
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
      event_id: eventId,
      buyer_id: user?.id,
      buyer_name: user?.name,
      type, vendor: form.vendor,
      confirmation_number: form.confirmation_number,
      amount: parseFloat(form.amount) || 0,
      details,
      departure_at: form.departure_at || null,
      arrival_at: form.arrival_at || null,
      check_in: form.check_in || null,
      check_out: form.check_out || null,
    })
    if (error) { alert('Error: ' + error.message); setSaving(false); return }
    onSaved()
  }

  const inp = (label: string, key: keyof typeof form, type = 'text', placeholder = '') => (
    <div key={key}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--mist)', marginBottom: 4 }}>{label}</label>
      <input type={type} value={form[key]} onChange={f(key)} placeholder={placeholder} style={{ width: '100%' }} />
    </div>
  )

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, overflowY: 'auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--cream)', borderRadius: 'var(--r2)', maxWidth: 560, width: '100%', boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ background: 'var(--sidebar-bg)', padding: '20px 24px', borderRadius: 'var(--r2) var(--r2) 0 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ color: '#fff', fontSize: 17, fontWeight: 900 }}>Add Reservation</div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff', width: 32, height: 32, borderRadius: '50%', fontSize: 18, cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Type selector */}
          <div style={{ display: 'flex', gap: 8 }}>
            {(['flight', 'hotel', 'rental_car'] as const).map(t => (
              <button key={t} onClick={() => setType(t)} style={{
                flex: 1, padding: '10px 4px', borderRadius: 'var(--r)', border: `2px solid ${type === t ? 'var(--green)' : 'var(--pearl)'}`,
                background: type === t ? 'var(--green-pale)' : 'var(--cream2)', cursor: 'pointer',
                fontWeight: 700, fontSize: 13, color: type === t ? 'var(--green-dark)' : 'var(--ash)',
              }}>
                {TYPE_LABELS[t].icon} {TYPE_LABELS[t].label}
              </button>
            ))}
          </div>

          {/* Common fields */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {inp('Vendor / Airline / Hotel Name', 'vendor')}
            {inp('Confirmation Number', 'confirmation_number')}
            {inp('Amount ($)', 'amount', 'number', '0.00')}
          </div>

          {/* Type-specific fields */}
          {type === 'flight' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {inp('Flight Number', 'flight_number', 'text', 'e.g. AA 1234')}
              {inp('From', 'from', 'text', 'e.g. ORD')}
              {inp('To', 'to', 'text', 'e.g. OMA')}
              {inp('Seat', 'seat', 'text', 'e.g. 14A')}
              {inp('Departure', 'departure_at', 'datetime-local')}
              {inp('Arrival', 'arrival_at', 'datetime-local')}
            </div>
          )}
          {type === 'hotel' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {inp('Address', 'address')}
              {inp('Room Type', 'room_type', 'text', 'e.g. King Suite')}
              {inp('Check-in', 'check_in', 'date')}
              {inp('Check-out', 'check_out', 'date')}
            </div>
          )}
          {type === 'rental_car' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {inp('Car Class', 'car_class', 'text', 'e.g. Compact SUV')}
              {inp('Pick-up Location', 'pickup_location', 'text', 'e.g. Terminal B')}
              {inp('Pick-up Date', 'check_in', 'date')}
              {inp('Return Date', 'check_out', 'date')}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn-primary" onClick={save} disabled={saving} style={{ flex: 1 }}>
              {saving ? 'Saving…' : 'Add Reservation'}
            </button>
            <button className="btn-outline" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── FOLDERS VIEW (legacy) ── */
function FoldersView({ ev, user }: { ev: Event; user: any }) {
  const [folders, setFolders] = useState<TravelFolder[]>([])
  const [items, setItems] = useState<TravelItem[]>([])
  const [selectedFolder, setSelectedFolder] = useState<TravelFolder | null>(null)
  const [loading, setLoading] = useState(true)
  const [newFolderName, setNewFolderName] = useState('')
  const [showNewFolder, setShowNewFolder] = useState(false)

  useEffect(() => { loadData() }, [ev.id])

  const loadData = async () => {
    setLoading(true)
    const [{ data: flds }, { data: itms }] = await Promise.all([
      supabase.from('travel_folders').select('*').eq('event_id', ev.id).order('sort_order'),
      supabase.from('travel_items').select('*').eq('event_id', ev.id).order('created_at'),
    ])
    let folderList = flds || []
    if (folderList.length === 0) {
      const defaults = ['Airlines', 'Rental Car', 'Hotel', 'Restaurant Notes']
      const { data: created } = await supabase.from('travel_folders').insert(
        defaults.map((name, i) => ({ event_id: ev.id, name, sort_order: i }))
      ).select()
      folderList = created || []
    }
    setFolders(folderList)
    setItems(itms || [])
    if (!selectedFolder && folderList.length > 0) setSelectedFolder(folderList[0])
    setLoading(false)
  }

  const createFolder = async () => {
    if (!newFolderName.trim()) return
    const { data } = await supabase.from('travel_folders').insert({ event_id: ev.id, name: newFolderName, sort_order: folders.length }).select().single()
    if (data) { setFolders(p => [...p, data]); setSelectedFolder(data) }
    setNewFolderName(''); setShowNewFolder(false)
  }

  if (loading) return <div style={{ color: 'var(--mist)' }}>Loading…</div>

  return (
    <div style={{ display: 'flex', gap: 20 }}>
      {/* Folder list */}
      <div style={{ width: 180, flexShrink: 0 }}>
        <div style={{ marginBottom: 8, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--mist)' }}>Folders</div>
        {folders.map(f => (
          <div key={f.id} onClick={() => setSelectedFolder(f)} style={{
            padding: '8px 12px', borderRadius: 'var(--r)', marginBottom: 4, cursor: 'pointer',
            background: selectedFolder?.id === f.id ? 'var(--green-pale)' : 'transparent',
            color: selectedFolder?.id === f.id ? 'var(--green-dark)' : 'var(--ink)',
            fontWeight: selectedFolder?.id === f.id ? 700 : 400, fontSize: 14,
            border: `1px solid ${selectedFolder?.id === f.id ? 'var(--green3)' : 'transparent'}`,
          }}>
            📁 {f.name}
          </div>
        ))}
        {showNewFolder ? (
          <div style={{ marginTop: 8 }}>
            <input value={newFolderName} onChange={e => setNewFolderName(e.target.value)} placeholder="Folder name" autoFocus style={{ width: '100%', marginBottom: 6 }} onKeyDown={e => e.key === 'Enter' && createFolder()} />
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn-primary btn-sm" onClick={createFolder}>Add</button>
              <button className="btn-ghost btn-sm" onClick={() => setShowNewFolder(false)}>×</button>
            </div>
          </div>
        ) : (
          <button className="btn-ghost btn-sm" onClick={() => setShowNewFolder(true)} style={{ marginTop: 8, width: '100%' }}>+ New Folder</button>
        )}
      </div>

      {/* Folder content */}
      <div style={{ flex: 1 }}>
        {selectedFolder && (
          <FolderContent folder={selectedFolder} eventId={ev.id} items={items.filter(i => i.folder_id === selectedFolder.id)}
            onItemsChange={newItems => setItems(p => [...p.filter(i => i.folder_id !== selectedFolder.id), ...newItems])} />
        )}
      </div>
    </div>
  )
}

/* ── FOLDER CONTENT ── */
function FolderContent({ folder, eventId, items, onItemsChange }: {
  folder: TravelFolder; eventId: string
  items: TravelItem[]; onItemsChange: (items: TravelItem[]) => void
}) {
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const addNote = async () => {
    if (!note.trim()) return
    setSaving(true)
    const { data } = await supabase.from('travel_items').insert({ folder_id: folder.id, event_id: eventId, type: 'note', content: note }).select().single()
    if (data) onItemsChange([...items, data])
    setNote('')
    setSaving(false)
  }

  const deleteItem = async (id: string) => {
    await supabase.from('travel_items').delete().eq('id', id)
    onItemsChange(items.filter(i => i.id !== id))
  }

  const uploadImage = async (file: File) => {
    const compressImage = (file: File): Promise<string> => new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        const img = new Image()
        img.onload = () => {
          const canvas = document.createElement('canvas')
          const MAX = 1200; let w = img.width, h = img.height
          if (w > MAX) { h = Math.round(h * MAX / w); w = MAX }
          if (h > MAX) { w = Math.round(w * MAX / h); h = MAX }
          canvas.width = w; canvas.height = h
          canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
          resolve(canvas.toDataURL('image/jpeg', 0.75))
        }
        img.src = e.target?.result as string
      }
      reader.readAsDataURL(file)
    })
    const dataUrl = await compressImage(file)
    const { data } = await supabase.from('travel_items').insert({ folder_id: folder.id, event_id: eventId, type: 'image', image_url: dataUrl, file_name: file.name }).select().single()
    if (data) onItemsChange([...items, data])
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setDragging(false)
    Array.from(e.dataTransfer.files).forEach(uploadImage)
  }

  const notes = items.filter(i => i.type === 'note')
  const images = items.filter(i => i.type === 'image')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Drop zone */}
      <div onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragging(true) }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false) }}
        onDrop={handleDrop} onClick={() => fileRef.current?.click()}
        style={{ border: `2px dashed ${dragging ? 'var(--green)' : 'var(--pearl)'}`, borderRadius: 'var(--r2)', padding: '24px', textAlign: 'center', cursor: 'pointer', background: dragging ? 'var(--green-pale)' : 'var(--cream)', transition: 'all .15s' }}>
        <div style={{ fontWeight: 700, color: dragging ? 'var(--green-dark)' : 'var(--ash)', fontSize: 14 }}>{dragging ? 'Drop to upload' : 'Drag & drop images here'}</div>
        <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 4 }}>or click to browse</div>
        <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => Array.from(e.target.files || []).forEach(uploadImage)} />
      </div>

      {/* Images */}
      {images.length > 0 && (
        <div className="card card-accent" style={{ margin: 0 }}>
          <div className="card-title">Images & Reservations</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
            {images.map(img => (
              <div key={img.id} style={{ borderRadius: 'var(--r)', overflow: 'hidden', border: '1px solid var(--pearl)' }}>
                <img src={img.image_url} alt={img.file_name} style={{ width: '100%', height: 140, objectFit: 'cover', display: 'block', cursor: 'zoom-in' }} onClick={() => setLightbox(img.image_url)} />
                <div style={{ padding: '6px 8px', background: 'var(--cream)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 10, color: 'var(--mist)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }}>{img.file_name}</span>
                  <button onClick={() => deleteItem(img.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mist)', fontSize: 14 }}>×</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Notes */}
      <div className="card card-accent" style={{ margin: 0 }}>
        <div className="card-title">Notes</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder={`Add a note to ${folder.name}…`} onKeyDown={e => e.key === 'Enter' && addNote()} style={{ flex: 1 }} />
          <button className="btn-primary btn-sm" onClick={addNote} disabled={saving || !note.trim()}>Add</button>
        </div>
        {notes.map(n => (
          <div key={n.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--cream2)' }}>
            <div style={{ flex: 1, fontSize: 14, color: 'var(--ink)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{n.content}</div>
            <button onClick={() => deleteItem(n.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mist)', fontSize: 16, flexShrink: 0 }}>×</button>
          </div>
        ))}
        {notes.length === 0 && <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--silver)', fontSize: 13 }}>No notes yet for {folder.name}.</div>}
      </div>

      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.92)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out', padding: 20 }}>
          <img src={lightbox} alt="Preview" style={{ maxWidth: '100%', maxHeight: '90vh', objectFit: 'contain', borderRadius: 8 }} />
          <button onClick={() => setLightbox(null)} style={{ position: 'fixed', top: 20, right: 24, background: 'rgba(255,255,255,.2)', border: 'none', color: '#fff', width: 36, height: 36, borderRadius: '50%', fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>
      )}
    </div>
  )
}
