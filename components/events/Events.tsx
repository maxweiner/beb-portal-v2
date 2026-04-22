'use client'

import { useState, useEffect, useCallback } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import { useAutosave, AutosaveIndicator } from '@/lib/useAutosave'
import type { Event, BuyerVacation } from '@/types'
import type { NavPage } from '@/app/page'
import EventNotesPanel from './EventNotesPanel'

type Filter = 'thisweek' | 'active' | 'all' | 'current' | 'past' | 'future' | 'days30' | 'days60'
type Sort = 'date-desc' | 'date-asc' | 'name-asc'

// ── Timeout wrapper: prevents permanent UI hangs from supabase deadlocks ──
// Accepts Supabase query builders (PromiseLike) as well as native Promises
const withTimeout = (promise: PromiseLike<any>, ms = 10000): Promise<any> => {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<any>((_, reject) =>
      setTimeout(() => reject(new Error('Request timed out')), ms)
    ),
  ])
}

export default function Events({ setNav }: { setNav?: (n: NavPage) => void }) {
  const { stores, users, user, brand, setEvents: setContextEvents, setDayEntryIntent } = useApp()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'
  const isSuperAdmin = user?.role === 'superadmin'

  const [events, setEvents] = useState<Event[]>([])
  const [eventsLoaded, setEventsLoaded] = useState(false)

  const [filter, setFilter] = useState<Filter>('thisweek')
  const [sort, setSort] = useState<Sort>('date-asc')
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [newEvent, setNewEvent] = useState({ store_id: '', start_date: '' })
  const [saving, setSaving] = useState(false)
  const [workersOpen, setWorkersOpen] = useState<string | null>(null)
  const [spendOpen, setSpendOpen] = useState<string | null>(null)
  const [detail, setDetail] = useState<Event | null>(null)
  const [notesEvent, setNotesEvent] = useState<Event | null>(null)
  const [noteCounts, setNoteCounts] = useState<Record<string, number>>({})
  const [noteCountsTick, setNoteCountsTick] = useState(0)

  // Lightweight count query — only pulls event_id columns. Refreshes whenever
  // a note is saved/deleted so the event-card badges stay accurate.
  useEffect(() => {
    ;(async () => {
      const { data } = await supabase.from('event_notes').select('event_id')
      const counts: Record<string, number> = {}
      for (const row of (data as { event_id: string }[] | null) || []) {
        counts[row.event_id] = (counts[row.event_id] || 0) + 1
      }
      setNoteCounts(counts)
    })()
  }, [noteCountsTick])

  // Navigate to Enter Day Data with event+day pre-selected. For superadmins,
  // land in Combined mode when event_days has data for that day, else By
  // Buyer — so legacy aggregate entries stay visible.
  const openDayEntry = (ev: Event, dayNumber: number) => {
    if (!setNav) return
    const evDay = (ev as any).days?.find((d: any) => d.day_number === dayNumber)
    const hasCombined = !!evDay && (
      (evDay.customers ?? 0) + (evDay.purchases ?? 0) + (evDay.dollars10 ?? 0) + (evDay.dollars5 ?? 0)
    ) > 0
    const mode: 'buyer' | 'combined' = isSuperAdmin && hasCombined ? 'combined' : 'buyer'
    setDayEntryIntent({ eventId: ev.id, day: dayNumber, mode })
    setNav('dayentry')
  }

  const today = new Date(); today.setHours(0,0,0,0)
  const buyers = users.filter(u => u.active && u.is_buyer !== false)

  // Fetch all buyer vacations for conflict checking
  const [buyerVacations, setBuyerVacations] = useState<BuyerVacation[]>([])
  useEffect(() => {
    supabase.from('buyer_vacations').select('*').then(({ data }) => setBuyerVacations(data || []))
  }, [])

  // ── Direct fetch — fresh query builder each time ──
  const fetchEvents = useCallback(async () => {
    try {
      const { data } = await withTimeout(
        supabase
          .from('events')
          .select('*, days:event_days(*), buyer_entries(*)')
          .eq('brand', brand)
          .order('start_date', { ascending: false })
      )
      if (data) {
        const mapped = data.map((e: any) => ({ ...e, days: e.days || [] }))
        setEvents(mapped)
        setContextEvents(mapped)
      }
    } catch (err) {
      console.error('fetchEvents error:', err)
    }
    setEventsLoaded(true)
  }, [brand, setContextEvents])

  useEffect(() => {
    fetchEvents()
  }, [fetchEvents])

  /* ── Filter & sort events ── */
  const filtered = events.filter(ev => {
    if (!ev.start_date) return false
    if (search) {
      const s = search.toLowerCase()
      const store = stores.find(st => st.id === ev.store_id)
      const match = (ev.store_name || '').toLowerCase().includes(s) ||
        (store?.city || '').toLowerCase().includes(s) ||
        (store?.state || '').toLowerCase().includes(s)
      if (!match) return false
    }
    if (search) {
      const s = search.toLowerCase()
      const store = stores.find(st => st.id === ev.store_id)
      const match = (ev.store_name || '').toLowerCase().includes(s) ||
        (store?.city || '').toLowerCase().includes(s) ||
        (store?.state || '').toLowerCase().includes(s)
      if (!match) return false
    }
    const start = new Date(ev.start_date + 'T12:00:00')
    const end = new Date(ev.start_date + 'T12:00:00')
    end.setDate(end.getDate() + 2); end.setHours(23,59,59)
    const isCur = today >= start && today <= end
    const isPast = end < today
    const isFut = start > today
    if (filter === 'thisweek') {
      const now = new Date(); now.setHours(0,0,0,0)
      const dow = now.getDay()
      const mon = new Date(now); mon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1)); mon.setHours(0,0,0,0)
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6); sun.setHours(23,59,59,999)
      return (start <= sun && end >= mon)
    }
    if (filter === 'active') return isCur || isFut
    if (filter === 'current') return isCur
    if (filter === 'past') return isPast
    if (filter === 'future') return isFut
    if (filter === 'days30') {
      const d30 = new Date(today); d30.setDate(d30.getDate() + 30)
      return start <= d30 && end >= today
    }
    if (filter === 'days60') {
      const d60 = new Date(today); d60.setDate(d60.getDate() + 60)
      return start <= d60 && end >= today
    }
    return true
  }).sort((a, b) => {
    if (sort === 'date-desc') return b.start_date.localeCompare(a.start_date)
    if (sort === 'date-asc') return a.start_date.localeCompare(b.start_date)
    return (a.store_name || '').localeCompare(b.store_name || '')
  })

  // ── CRITICAL: fresh insert + direct re-fetch, no reload() ──
  const createEvent = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newEvent.store_id || !newEvent.start_date) return
    setSaving(true)
    try {
      const store = stores.find(s => s.id === newEvent.store_id)

      // Fresh query builder — never reuse
      const { data, error } = await withTimeout(
        supabase.from('events').insert({
          brand,
          store_id: newEvent.store_id,
          store_name: store?.name || '',
          start_date: newEvent.start_date,
          created_by: user?.id,
        }).select().single()
      )
      if (error) { alert('Failed to create event: ' + error.message); return }

      // Reset form
      setShowForm(false)
      setNewEvent({ store_id: '', start_date: '' })

      // Re-fetch with a fresh query
      const { data: freshEvents } = await withTimeout(
        supabase
          .from('events')
          .select('*, days:event_days(*), buyer_entries(*)')
          .eq('brand', brand)
          .order('start_date', { ascending: false })
      )
      if (freshEvents) {
        const mapped = freshEvents.map((ev: any) => ({ ...ev, days: ev.days || [] }))
        setEvents(mapped)
        setContextEvents(mapped)
      }
    } catch (err: any) {
      alert('Error creating event: ' + (err?.message || 'unknown'))
    } finally {
      setSaving(false)
    }
  }

  // ── Optimistic delete ──
  const deleteEvent = async (id: string) => {
    if (!confirm('Delete this event? This cannot be undone.')) return

    const prev = events
    const updated = events.filter(ev => ev.id !== id)
    setEvents(updated)
    setContextEvents(updated)

    try {
      const { error } = await withTimeout(
        supabase.from('events').delete().eq('id', id)
      )
      if (error) {
        setEvents(prev)
        setContextEvents(prev)
        alert('Delete failed: ' + error.message)
      }
    } catch (err: any) {
      setEvents(prev)
      setContextEvents(prev)
      alert('Delete failed: ' + (err?.message || 'timeout'))
    }
  }

  // ── Toggle worker with local state update ──
  const toggleWorker = async (ev: Event, uid: string, name: string) => {
    const workers = ev.workers || []
    const exists = workers.find(w => w.id === uid)
    if (!exists) {
      const evDays = [0, 1, 2].map(i => {
        const d = new Date(ev.start_date + 'T12:00:00')
        d.setDate(d.getDate() + i)
        return d.toISOString().slice(0, 10)
      })
      const conflicts = events.filter(other => {
        if (other.id === ev.id) return false
        if (!(other.workers || []).some(w => w.id === uid)) return false
        const otherDays = [0, 1, 2].map(i => {
          const d = new Date(other.start_date + 'T12:00:00')
          d.setDate(d.getDate() + i)
          return d.toISOString().slice(0, 10)
        })
        return evDays.some(d => otherDays.includes(d))
      })
      if (conflicts.length > 0) {
        const conflictNames = conflicts.map(c => `${c.store_name} (${c.start_date})`).join(', ')
        alert(`⚠️ Conflict! ${name} is already assigned to: ${conflictNames}\n\nA buyer cannot work two events on the same day.`)
        return
      }
    }
    const updated = exists ? workers.filter(w => w.id !== uid) : [...workers, { id: uid, name }]
    try {
      await withTimeout(
        supabase.from('events').update({ workers: updated }).eq('id', ev.id)
      )
    } catch (err: any) {
      alert('Failed to update workers: ' + (err?.message || 'timeout'))
      return
    }
    const updatedEvents = events.map(e => e.id === ev.id ? { ...e, workers: updated } : e)
    setEvents(updatedEvents)
    setContextEvents(updatedEvents)
  }

  const copyLink = (ev: Event) => {
    navigator.clipboard.writeText(`${window.location.origin}/event/${ev.id}`)
    alert('Event summary link copied to clipboard!')
  }

  const isCurrent = (ev: Event) => {
    const start = new Date(ev.start_date + 'T12:00:00')
    const end = new Date(ev.start_date + 'T12:00:00')
    end.setDate(end.getDate() + 2)
    end.setHours(23, 59, 59)
    return today >= start && today <= end
  }

  const isStale = (ev: Event) => {
    const end = new Date(ev.start_date + 'T12:00:00')
    end.setDate(end.getDate() + 2)
    end.setHours(23, 59, 59)
    return (today.getTime() - end.getTime()) > 7 * 24 * 60 * 60 * 1000
  }

  const fmt = (ds: string) => new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const fmtDollars = (n: number) => `$${Math.round(n).toLocaleString()}`

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-black" style={{ color: 'var(--ink)' }}>
          Events <span className="text-base font-normal" style={{ color: 'var(--fog)' }}>({filtered.length} of {events.length})</span>
        </h1>
        <div className="flex gap-2 flex-wrap">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search stores…" style={{ width: 160 }} />
          <select value={filter} onChange={e => setFilter(e.target.value as Filter)} style={{ width: 'auto' }}>
            <option value="thisweek">This Week</option>
            <option value="active">Current & Upcoming</option>
            <option value="all">All Events</option>
            <option value="days30">Next 30 Days</option>
            <option value="days60">Next 60 Days</option>
            <option value="past">Past</option>
          </select>
          <select value={sort} onChange={e => setSort(e.target.value as Sort)} style={{ width: 'auto' }}>
            <option value="date-desc">Furthest Away</option>
            <option value="date-asc">Soonest Event</option>
            <option value="name-asc">Store Name</option>
          </select>
          {isAdmin && (
            <button onClick={() => setShowForm(true)} className="btn-primary btn-sm">+ New Event</button>
          )}
        </div>
      </div>

      {showForm && (
        <div className="card mb-5" style={{ border: '2px solid var(--green3)', marginBottom: 20 }}>
          <div className="card-title">New Event</div>
          <form onSubmit={createEvent} className="flex gap-3 flex-wrap items-end">
            <div className="field" style={{ minWidth: 200 }}>
              <label className="fl">Store</label>
              <select value={newEvent.store_id} onChange={e => setNewEvent(p => ({ ...p, store_id: e.target.value }))} required>
                <option value="">Select store…</option>
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="fl">Start Date</label>
              <input type="date" value={newEvent.start_date} onChange={e => setNewEvent(p => ({ ...p, start_date: e.target.value }))} required />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" disabled={saving} className="btn-primary btn-sm">{saving ? 'Creating…' : 'Create Event'}</button>
              <button type="button" onClick={() => setShowForm(false)} className="btn-outline btn-sm">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="space-y-3">
        {filtered.length === 0 && (
          <div className="text-center py-16" style={{ color: 'var(--mist)' }}>
            <div className="text-4xl mb-3">◎</div>
            <div className="font-bold">No events found</div>
          </div>
        )}
        {filtered.map(ev => {
          const cur = isCurrent(ev)
          const purchases = ev.days.reduce((s, d) => s + (d.purchases || 0), 0)
          const dollars = ev.days.reduce((s, d) => s + (d.dollars10 || 0) + (d.dollars5 || 0), 0)
          const store = stores.find(s => s.id === ev.store_id)
          const evWorkers = ev.workers || []
          const wOpen = workersOpen === ev.id
          const totalSpend = (ev.spend_vdp||0)+(ev.spend_newspaper||0)+(ev.spend_postcard||0)+(ev.spend_spiffs||0)

          const stale = isStale(ev)
          const upcoming = !cur && !stale && new Date(ev.start_date + 'T12:00:00') > today

          return (
            <div key={ev.id} className="card"
              style={{
                border: cur ? '1px solid var(--green)' : upcoming ? '1px solid var(--green)' : '1px solid var(--pearl)',
                boxShadow: cur ? '0 0 0 2px var(--green-pale)' : 'none',
                borderLeft: cur ? '4px solid var(--green)' : upcoming ? '4px solid var(--green)' : stale ? '4px solid var(--pearl)' : '1px solid var(--pearl)',
                opacity: stale ? 0.55 : 1,
                cursor: 'pointer',
                transition: 'opacity .2s',
              }}
              onClick={() => setDetail(ev)}>

              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-black text-base" style={{ color: 'var(--ink)' }}>◆ {ev.store_name}</span>
                    {cur && <span className="badge badge-jade">Current</span>}
                  </div>
                  <div className="text-sm" style={{ color: 'var(--mist)' }}>
                    {store?.city}, {store?.state} · {fmt(ev.start_date)}
                  </div>
                  {evWorkers.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {evWorkers.map(w => {
                        const u = users.find(x => x.id === w.id)
                        const tip = [u?.phone, u?.email].filter(Boolean).join(' · ') || ''
                        return (
                          <span key={w.id} className="px-2 py-0.5 rounded-full text-xs font-bold"
                            title={tip}
                            style={{ background: 'var(--green-pale)', color: 'var(--green-dark)', border: '1px solid var(--green3)', cursor: tip ? 'help' : 'default' }}>
                            👤 {w.name}
                          </span>
                        )
                      })}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                  <div className="flex gap-4">
                    {(() => {
                      const stats = [
                        { label: 'Days', value: ev.days.length },
                        { label: 'Purchases', value: purchases },
                        { label: '💰 Amount Spent', value: fmtDollars(dollars) },
                      ]
                      if (totalSpend > 0) stats.unshift({ label: 'Ad Spend', value: fmtDollars(totalSpend) })
                      return stats.map(({ label, value }) => (
                        <div key={label} className="text-center">
                          <div className="text-xl font-black" style={{ color: 'var(--green)' }}>{value}</div>
                          <div className="text-xs" style={{ color: 'var(--mist)' }}>{label}</div>
                        </div>
                      ))
                    })()}
                  </div>
                  {(() => {
                    const totalCustomers = ev.days.reduce((s, d) => s + (d.customers || 0), 0)
                    const costPerLead = totalSpend > 0 && totalCustomers > 0 ? totalSpend / totalCustomers : null
                    const adSpendRatio = totalSpend > 0 && dollars > 0 ? dollars / totalSpend : null
                    if (!costPerLead && !adSpendRatio) return null
                    return (
                      <div className="flex gap-4" style={{ paddingTop: 4, borderTop: '1px solid var(--cream2)' }}>
                        {costPerLead !== null && (
                          <div className="text-center">
                            <div className="text-sm font-black" style={{ color: 'var(--ash)' }}>{fmtDollars(costPerLead)}</div>
                            <div className="text-xs" style={{ color: 'var(--mist)' }}>Cost Per Lead</div>
                          </div>
                        )}
                        {adSpendRatio !== null && (
                          <div className="text-center">
                            <div className="text-sm font-black" style={{ color: 'var(--ash)' }}>{adSpendRatio.toFixed(1)}x</div>
                            <div className="text-xs" style={{ color: 'var(--mist)' }}>Ad Spend Ratio</div>
                          </div>
                        )}
                      </div>
                    )
                  })()}
                </div>
              </div>

              {/* Day pills — navigation links to Enter Day Data. Pill total
                  is hybrid (Q1): per-buyer sum if any rows, else event_days. */}
              <div className="flex gap-2 mt-4" onClick={e => e.stopPropagation()}>
                {[1, 2, 3].map(d => {
                  const day = (ev.days || []).find(x => x.day_number === d)
                  const dayBuyerEntries = ((ev as any).buyer_entries || []).filter((e: any) => e.day_number === d)
                  const eventWorkerCount = (ev.workers || []).length
                  const submittedCount = dayBuyerEntries.filter((e: any) => e.submitted_at).length
                  const startedCount = dayBuyerEntries.length

                  const buyerTotal = dayBuyerEntries.reduce(
                    (s: number, e: any) => s + (Number(e.dollars_at_10pct) || 0) + (Number(e.dollars_at_5pct) || 0),
                    0
                  )
                  const aggregateTotal = day ? (Number(day.dollars10) || 0) + (Number(day.dollars5) || 0) : 0
                  const dayTotal = dayBuyerEntries.length > 0 ? buyerTotal : aggregateTotal

                  const hasData = dayTotal > 0 || (day && (day.purchases > 0 || day.customers > 0))
                  const allSubmitted = eventWorkerCount > 0 && submittedCount === eventWorkerCount
                  const someSubmitted = submittedCount > 0 || startedCount > 0
                  const dotColor = hasData || allSubmitted ? 'var(--green)' : someSubmitted ? '#f59e0b' : 'var(--cream2)'
                  const textColor = (hasData || allSubmitted || someSubmitted) ? '#fff' : 'var(--silver)'
                  const totalLabel = dayTotal > 0 ? ` · $${Math.round(dayTotal).toLocaleString('en-US')}` : ''
                  return (
                    <button key={d}
                      onClick={e => { e.stopPropagation(); openDayEntry(ev, d) }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '6px 12px', borderRadius: 99, border: 'none', cursor: 'pointer',
                        background: dotColor, color: textColor,
                        fontWeight: 700, fontSize: 12,
                        boxShadow: someSubmitted ? '0 1px 4px rgba(45,106,79,.3)' : 'none',
                        transition: 'all .15s',
                      }}>
                      <span style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: (hasData || allSubmitted || someSubmitted) ? '#fff' : 'var(--silver)',
                        display: 'inline-block', flexShrink: 0,
                      }} />
                      Day {d}{totalLabel}
                      {someSubmitted && !dayTotal && <span style={{ opacity: .8, fontSize: 11 }}>{submittedCount}/{eventWorkerCount}</span>}
                    </button>
                  )
                })}
              </div>

              {/* Workers panel */}
              {wOpen && (
                <div className="mt-4 p-4 rounded-xl" style={{ background: 'var(--cream2)', border: '1px solid var(--pearl)' }} onClick={e => e.stopPropagation()}>
                  <div className="fl">Who Worked This Event</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                    {buyers.map(b => {
                      const on = evWorkers.some(w => w.id === b.id)
                      return (
                        <div key={b.id} onClick={() => toggleWorker(ev, b.id, b.name)}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14, padding: '4px 0' }}>
                          <div style={{
                            width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            ...(on
                              ? { background: 'var(--green)' }
                              : { border: '2.5px solid var(--pearl)' })
                          }}>
                            {on && <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 12.5 C6 12.5, 8 17, 9.5 19 C12 14, 16 8, 20 5" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                          </div>
                          <span style={{ fontWeight: on ? 700 : 400, color: on ? 'var(--green-dark)' : 'var(--ash)' }}>{b.name}</span>
                          <span style={{ fontSize: 12, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{b.role}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Spend panel */}
              {spendOpen === ev.id && (
                <SpendPanel ev={ev} onClose={() => setSpendOpen(null)} refetchEvents={fetchEvents} />
              )}

              {/* Actions */}
              <div className="flex gap-2 mt-3 pt-3 flex-wrap" style={{ borderTop: '1px solid var(--cream2)' }} onClick={e => e.stopPropagation()}>
                <button onClick={e => { e.stopPropagation(); setWorkersOpen(wOpen ? null : ev.id) }}
                  className={wOpen ? 'btn-ghost btn-xs' : 'btn-outline btn-xs'}>
                  👤 Who Worked
                </button>
                <button onClick={e => { e.stopPropagation(); setSpendOpen(spendOpen === ev.id ? null : ev.id) }}
                  className={spendOpen === ev.id ? 'btn-ghost btn-xs' : 'btn-outline btn-xs'}>
                  💰 Ad Spend
                </button>
                <button onClick={e => { e.stopPropagation(); setNotesEvent(ev) }}
                  className="btn-outline btn-xs" style={{ position: 'relative' }}>
                  📝 Notes
                  {(() => {
                    const count = noteCounts[ev.id] || 0
                    if (count === 0) {
                      return (
                        <span aria-hidden style={{
                          position: 'absolute', top: -3, right: -3,
                          width: 8, height: 8, borderRadius: '50%',
                          background: '#D97706', border: '2px solid var(--cream)',
                        }} />
                      )
                    }
                    return (
                      <span style={{
                        marginLeft: 6, background: 'var(--green-pale)', color: 'var(--green-dark)',
                        fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
                      }}>{count}</span>
                    )
                  })()}
                </button>
                <button onClick={e => { e.stopPropagation(); copyLink(ev) }} className="btn-outline btn-xs">
                  🔗 Copy Link
                </button>
                {isAdmin && (
                  <button onClick={e => { e.stopPropagation(); deleteEvent(ev.id) }} className="btn-danger btn-xs">Delete</button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Detail Modal */}
      {detail && (
        <EventDetailModal ev={detail} stores={stores} onClose={() => setDetail(null)} fmtDollars={fmtDollars} />
      )}

      {/* Notes panel */}
      {notesEvent && (
        <EventNotesPanel
          event={notesEvent}
          store={stores.find(s => s.id === notesEvent.store_id)}
          onClose={() => setNotesEvent(null)}
          onNotesChanged={() => setNoteCountsTick(t => t + 1)}
        />
      )}
    </div>
  )
}

/* ══ EVENT DETAIL MODAL ══ */
function EventDetailModal({ ev, stores, onClose, fmtDollars }: {
  ev: Event
  stores: any[]
  onClose: () => void
  fmtDollars: (n: number) => string
}) {
  const store = stores.find(s => s.id === ev.store_id)
  const days = [...(ev.days || [])].sort((a, b) => a.day_number - b.day_number)
  const totalPurchases = days.reduce((s, d) => s + (d.purchases || 0), 0)
  const totalCustomers = days.reduce((s, d) => s + (d.customers || 0), 0)
  const totalDollars = days.reduce((s, d) => s + (d.dollars10 || 0) + (d.dollars5 || 0), 0)
  const totalCommission = days.reduce((s, d) => s + (d.dollars10 || 0) * 0.10 + (d.dollars5 || 0) * 0.05, 0)
  const closeRate = totalCustomers > 0 ? Math.round(totalPurchases / totalCustomers * 100) : 0

  const fmt = (ds: string) => new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, overflowY: 'auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--cream)', borderRadius: 'var(--r2)', maxWidth: 600, width: '100%', boxShadow: 'var(--shadow-lg)' }}>

        <div style={{ background: 'var(--sidebar-bg)', padding: '20px 24px', borderRadius: 'var(--r2) var(--r2) 0 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ color: '#7EC8A0', fontSize: 14 }}>◆ Event Details</div>
            <div style={{ color: '#fff', fontSize: 18, fontWeight: 900, marginTop: 2 }}>{ev.store_name}</div>
            <div style={{ color: 'rgba(255,255,255,.5)', fontSize: 13, marginTop: 2 }}>{store?.city}, {store?.state} · {ev.start_date}</div>
          </div>
          <button onClick={onClose}
            style={{ background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff', width: 32, height: 32, borderRadius: '50%', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="card card-accent" style={{ margin: 0 }}>
            <div className="card-title">Event Summary</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {[
                ['Customers', totalCustomers.toLocaleString()],
                ['Purchases', totalPurchases.toLocaleString()],
                ['Close Rate', `${closeRate}%`],
                ['💰 Amount Spent', fmtDollars(totalDollars)],
                ['Commission Due', fmtDollars(totalCommission)],
                ['Days Entered', `${days.length} of 3`],
              ].map(([label, value]) => (
                <div key={label}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--mist)', marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--ink)' }}>{value}</div>
                </div>
              ))}
            </div>
          </div>

          {days.length > 0 && (
            <div className="card card-accent" style={{ margin: 0 }}>
              <div className="card-title">Day by Day</div>
              {days.map(d => {
                const dayDate = new Date(ev.start_date + 'T12:00:00')
                dayDate.setDate(dayDate.getDate() + d.day_number - 1)
                const dayDateStr = isNaN(dayDate.getTime()) ? '' : dayDate.toISOString().slice(0, 10)
                const dayDollars = (d.dollars10 || 0) + (d.dollars5 || 0)
                const dayCR = d.customers > 0 ? Math.round(d.purchases / d.customers * 100) : 0
                return (
                  <div key={d.day_number} style={{ paddingBottom: 16, marginBottom: 16, borderBottom: '1px solid var(--cream2)' }}>
                    <div style={{ fontWeight: 700, color: 'var(--green)', marginBottom: 8 }}>Day {d.day_number}{dayDateStr ? ` — ${fmt(dayDateStr)}` : ''}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, fontSize: 13 }}>
                      {[['Customers', d.customers || 0], ['Purchases', d.purchases || 0], ['💰 Amount Spent', fmtDollars(dayDollars)], ['Close', `${dayCR}%`]].map(([l, v]) => (
                        <div key={l as string}>
                          <div style={{ color: 'var(--mist)', fontSize: 11, marginBottom: 2 }}>{l}</div>
                          <div style={{ fontWeight: 700 }}>{v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {(ev.spend_vdp || ev.spend_newspaper || ev.spend_postcard || ev.spend_spiffs) ? (
            <div className="card card-accent" style={{ margin: 0 }}>
              <div className="card-title">Ad Spend & Spiffs</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[['VDP Spend', ev.spend_vdp], ['Newspaper Spend', ev.spend_newspaper], ['Postcard Spend', ev.spend_postcard], ['Spiffs Paid', ev.spend_spiffs]].map(([label, value]) => value ? (
                  <div key={label as string}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--mist)', marginBottom: 2 }}>{label}</div>
                    <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--ink)' }}>${Math.round(Number(value)).toLocaleString()}</div>
                  </div>
                ) : null)}
              </div>
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--cream2)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--mist)', marginBottom: 2 }}>Total Spend</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--ink)' }}>${Math.round((ev.spend_vdp || 0) + (ev.spend_newspaper || 0) + (ev.spend_postcard || 0) + (ev.spend_spiffs || 0)).toLocaleString()}</div>
              </div>
            </div>
          ) : null}

          {(ev.workers || []).length > 0 && (
            <div className="card card-accent" style={{ margin: 0 }}>
              <div className="card-title">Who Worked</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(ev.workers || []).map((w: any) => (
                  <span key={w.id} className="badge badge-jade">{w.name}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ══ SPEND PANEL ══ */
function SpendPanel({ ev, onClose, refetchEvents }: { ev: Event; onClose: () => void; refetchEvents: () => Promise<void> }) {
  const [spend, setSpend] = useState({
    spend_vdp:       String(ev.spend_vdp       || ''),
    spend_newspaper: String(ev.spend_newspaper || ''),
    spend_postcard:  String(ev.spend_postcard  || ''),
    spend_spiffs:    String(ev.spend_spiffs    || ''),
  })

  const status = useAutosave(
    spend,
    async (s) => {
      const { error } = await withTimeout(
        supabase.from('events').update({
          spend_vdp:       parseFloat(s.spend_vdp)       || 0,
          spend_newspaper: parseFloat(s.spend_newspaper) || 0,
          spend_postcard:  parseFloat(s.spend_postcard)  || 0,
          spend_spiffs:    parseFloat(s.spend_spiffs)    || 0,
        }).eq('id', ev.id)
      )
      if (error) throw error
      await refetchEvents()
    },
    { delay: 1000 }
  )

  const totalSpend = (parseFloat(spend.spend_vdp) || 0) +
    (parseFloat(spend.spend_newspaper) || 0) +
    (parseFloat(spend.spend_postcard) || 0) +
    (parseFloat(spend.spend_spiffs) || 0)

  const inp = (label: string, key: keyof typeof spend) => (
    <div key={key}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--mist)', marginBottom: 4 }}>{label}</label>
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--mist)', fontSize: 14 }}>$</span>
        <input type="number" min="0" step="0.01" value={spend[key]}
          onChange={e => setSpend(p => ({ ...p, [key]: e.target.value }))}
          placeholder="0.00"
          style={{ paddingLeft: 24, fontSize: 14 }} />
      </div>
    </div>
  )

  return (
    <div className="mt-4 p-4 rounded-xl" style={{ background: 'var(--cream2)', border: '1px solid var(--pearl)' }} onClick={e => e.stopPropagation()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div className="fl" style={{ margin: 0, display: 'flex', alignItems: 'center' }}>
          Ad Spend & Spiffs
          <AutosaveIndicator status={status} />
        </div>
        {totalSpend > 0 && (
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)' }}>
            Total: ${Math.round(totalSpend).toLocaleString()}
          </div>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        {inp('VDP Spend', 'spend_vdp')}
        {inp('Newspaper Spend', 'spend_newspaper')}
        {inp('Postcard Spend', 'spend_postcard')}
        {inp('Spiffs Paid', 'spend_spiffs')}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn-outline btn-sm" onClick={onClose}>Done</button>
      </div>
    </div>
  )
}

