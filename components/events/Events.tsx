'use client'

import { useState, useEffect, useCallback } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import { useAutosave, AutosaveIndicator } from '@/lib/useAutosave'
import { isMobileDevice } from '@/lib/mobile'
import { canEditEvent } from '@/lib/permissions'
import type { Event, BuyerVacation } from '@/types'
import type { NavPage } from '@/app/page'
import EventNotesPanel from './EventNotesPanel'
import NotificationStatusBadge from '@/components/notifications/NotificationStatusBadge'
import EventMarketingSummary from '@/components/marketing/EventMarketingSummary'

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

// Stable per-user avatar colors. Same user → same color every render.
const AVATAR_COLORS = [
  '#1D6B44', '#2E86AB', '#6D4C41', '#5C6BC0', '#00897B',
  '#E65100', '#AD1457', '#546E7A', '#7B1FA2', '#2E7D32',
] as const
function getAvatarColor(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash) + userId.charCodeAt(i)
    hash = hash | 0
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}
function getInitials(name: string): string {
  const parts = (name || '').trim().split(/\s+/)
  if (parts.length === 0 || !parts[0]) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
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
  const [marketingOpen, setMarketingOpen] = useState<string | null>(null)
  const [detail, setDetail] = useState<Event | null>(null)
  const [notesEvent, setNotesEvent] = useState<Event | null>(null)
  const [noteCounts, setNoteCounts] = useState<Record<string, number>>({})
  const [noteCountsTick, setNoteCountsTick] = useState(0)

  // Mobile detection — forks the event card layout only on mobile. Desktop
  // path stays identical to before.
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => { setIsMobile(isMobileDevice()) }, [])

  // Per-card expanded state for the mobile card layout. Desktop cards are
  // always "expanded" (the existing full markup).
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set())
  const toggleCard = (id: string) => setExpandedCards(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

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
    if (!canEditEvent(user, ev)) {
      alert("You're not assigned to this event")
      return
    }
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
      // Route through the chokepoint so the buyer_added_to_event /
      // buyer_removed notification side-effects fire reliably.
      const res = await withTimeout(
        fetch(`/api/events/${ev.id}/workers`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workers: updated }),
        })
      ) as Response
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `HTTP ${res.status}`)
      }
    } catch (err: any) {
      alert('Failed to update workers: ' + (err?.message || 'timeout'))
      return
    }
    const updatedEvents = events.map(e => e.id === ev.id ? { ...e, workers: updated } : e)
    setEvents(updatedEvents)
    setContextEvents(updatedEvents)
  }

  // Open the print-styled event recap in a new tab. The ?print=1 flag
  // injects a window.print() call so the browser's PDF dialog fires
  // automatically — same flow used by Reports → Event Recap.
  const downloadPdf = (ev: Event) => {
    window.open(`/api/event-recap/preview?event_id=${ev.id}&print=1`, '_blank', 'noopener')
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
  const fmtRange = (startDate: string) => {
    const start = new Date(startDate + 'T12:00:00')
    const end = new Date(startDate + 'T12:00:00'); end.setDate(end.getDate() + 2)
    const sMonth = start.toLocaleDateString('en-US', { month: 'short' })
    const eMonth = end.toLocaleDateString('en-US', { month: 'short' })
    if (sMonth === eMonth) return `${sMonth} ${start.getDate()}–${end.getDate()}`
    return `${sMonth} ${start.getDate()} – ${eMonth} ${end.getDate()}`
  }
  const todayISO = today.toISOString().split('T')[0]

  // Auto-expand current + upcoming mobile cards; collapse past + stale.
  useEffect(() => {
    if (!isMobile) return
    const next = new Set<string>()
    for (const ev of filtered) {
      const start = new Date(ev.start_date + 'T12:00:00')
      if (isCurrent(ev) || (!isStale(ev) && start > today)) next.add(ev.id)
    }
    setExpandedCards(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile, filtered.length, filtered.map(e => e.id).join('|')])

  // Desktop: only auto-expand current events. Upcoming + past start collapsed.
  useEffect(() => {
    if (isMobile) return
    const next = new Set<string>()
    for (const ev of filtered) if (isCurrent(ev)) next.add(ev.id)
    setExpandedCards(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile, filtered.length, filtered.map(e => e.id).join('|')])

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

          /* ───── Mobile card layout — rendered only on mobile ───── */
          if (isMobile) {
            const expanded = expandedCards.has(ev.id)
            const isSuperAdmin = user?.role === 'superadmin'
            const noteCount = noteCounts[ev.id] || 0
            const AVATAR_COLORS = ['#1D6B44', '#166038', '#14532d', '#0F4A28']

            return (
              <div key={ev.id} style={{
                background: 'var(--card-bg)',
                border: '1px solid var(--pearl)',
                borderRadius: 10,
                overflow: 'hidden',
                marginBottom: 12,
                opacity: stale ? 0.55 : 1,
                transition: 'opacity .2s',
              }}>
                {/* Header — tappable, toggles collapse */}
                <div onClick={() => toggleCard(ev.id)} style={{
                  background: 'var(--sidebar-bg)',
                  color: '#fff',
                  padding: '12px 14px',
                  cursor: 'pointer',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{
                      fontSize: 15, fontWeight: 900, flex: 1, minWidth: 0,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{ev.store_name}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <span style={{ fontSize: 15, fontWeight: 900, color: 'var(--green3)' }}>{fmtDollars(dollars)}</span>
                      <span aria-hidden style={{
                        fontSize: 16, color: 'rgba(255,255,255,.7)', display: 'inline-block',
                        transition: 'transform .2s',
                        transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                      }}>▾</span>
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', marginTop: 3 }}>
                    {store?.city}{store?.state ? ', ' + store.state : ''} · {fmtRange(ev.start_date)}
                    {cur && <span style={{ color: 'var(--green3)', fontWeight: 700, marginLeft: 6 }}>· Current</span>}
                  </div>
                </div>

                {expanded && (
                  <>
                    {/* Avatar stack + comma-separated first names */}
                    <div style={{ padding: '10px 14px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                      {evWorkers.length === 0 ? (
                        <div style={{ fontSize: 13, color: 'var(--mist)', fontStyle: 'italic' }}>No buyers assigned</div>
                      ) : (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center' }}>
                            {evWorkers.slice(0, 5).map((w, i) => {
                              const displayAsMore = i === 4 && evWorkers.length > 5
                              const initials = displayAsMore
                                ? `+${evWorkers.length - 4}`
                                : (w.name || '').split(/\s+/).map(s => s[0] || '').slice(0, 2).join('').toUpperCase() || '?'
                              const total = Math.min(evWorkers.length, 5)
                              return (
                                <div key={displayAsMore ? 'more' : w.id} style={{
                                  width: 28, height: 28, borderRadius: '50%',
                                  background: displayAsMore ? '#9CA3AF' : AVATAR_COLORS[i % AVATAR_COLORS.length],
                                  border: '2px solid var(--card-bg)',
                                  color: '#fff', fontSize: 11, fontWeight: 900,
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  marginLeft: i === 0 ? 0 : -8,
                                  zIndex: total - i,
                                  position: 'relative',
                                }}>{initials}</div>
                              )
                            })}
                          </div>
                          <div style={{
                            fontSize: 13, fontWeight: 700, color: 'var(--ash)',
                            flex: 1, minWidth: 0,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {evWorkers.map(w => (w.name || '').split(/\s+/)[0]).filter(Boolean).join(', ')}
                          </div>
                        </>
                      )}
                    </div>

                    {/* Day-by-day spend cards. Body click opens detail modal. */}
                    <div onClick={e => { e.stopPropagation(); setDetail(ev) }}
                      style={{ padding: '10px 14px 0', display: 'flex', gap: 6, cursor: 'pointer' }}>
                      {[1, 2, 3].map(d => {
                        const day = (ev.days || []).find((x: any) => x.day_number === d)
                        const dayDollars = day ? (Number(day.dollars10) || 0) + (Number(day.dollars5) || 0) : 0
                        const dayPurch = day ? (Number(day.purchases) || 0) : 0
                        const hasData = !!day && (dayDollars > 0 || dayPurch > 0 || (Number(day.customers) || 0) > 0)
                        const dayDate = new Date(ev.start_date + 'T12:00:00')
                        dayDate.setDate(dayDate.getDate() + d - 1)
                        const dayISO = dayDate.toISOString().split('T')[0]
                        const isToday = dayISO === todayISO
                        if (hasData) {
                          return (
                            <div key={d} style={{
                              flex: 1, background: '#fff',
                              border: '1px solid var(--green3)',
                              borderRadius: 8, padding: '8px 6px', textAlign: 'center',
                            }}>
                              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--green-dark)', marginBottom: 2 }}>Day {d}</div>
                              <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--green)' }}>{fmtDollars(dayDollars)}</div>
                              <div style={{ fontSize: 10, color: 'var(--mist)' }}>{dayPurch} purch</div>
                            </div>
                          )
                        }
                        return (
                          <div key={d} style={{
                            flex: 1, background: 'var(--cream2)',
                            border: '1px dashed var(--pearl)',
                            borderRadius: 8, padding: '8px 6px', textAlign: 'center',
                          }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--silver)' }}>Day {d}</div>
                            <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--silver)' }}>—</div>
                            <div style={{ fontSize: 10, color: 'var(--silver)', minHeight: 12 }}>{isToday ? 'today' : ''}</div>
                          </div>
                        )
                      })}
                    </div>

                    {/* Existing inline workers + spend panels. Reuse the same
                        markup so desktop and mobile stay in sync. */}
                    {wOpen && (
                      <div className="m-3 p-3 rounded-xl" style={{ background: 'var(--cream2)', border: '1px solid var(--pearl)' }} onClick={e => e.stopPropagation()}>
                        <div className="fl">Who Worked This Event{!isAdmin && ' (read only)'}</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                          {(isAdmin ? buyers : buyers.filter(b => evWorkers.some((w: any) => w.id === b.id))).map(b => {
                            const on = evWorkers.some((w: any) => w.id === b.id)
                            return (
                              <div key={b.id} onClick={isAdmin ? () => toggleWorker(ev, b.id, b.name) : undefined}
                                style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: isAdmin ? 'pointer' : 'default', fontSize: 14, padding: '6px 0', minHeight: 36 }}>
                                {isAdmin && (
                                  <div style={{
                                    width: 26, height: 26, borderRadius: 6, flexShrink: 0,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    ...(on ? { background: 'var(--green)' } : { border: '2.5px solid var(--pearl)' })
                                  }}>
                                    {on && <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 12.5 C6 12.5, 8 17, 9.5 19 C12 14, 16 8, 20 5" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                                  </div>
                                )}
                                <span style={{ fontWeight: on ? 700 : 400, color: on ? 'var(--green-dark)' : 'var(--ash)' }}>{b.name}</span>
                              </div>
                            )
                          })}
                          {!isAdmin && evWorkers.length === 0 && (
                            <div style={{ fontSize: 13, color: 'var(--mist)', fontStyle: 'italic' }}>No workers assigned yet.</div>
                          )}
                        </div>
                      </div>
                    )}
                    {spendOpen === ev.id && (
                      <div onClick={e => e.stopPropagation()} style={{ padding: '0 12px' }}>
                        <SpendPanel ev={ev} onClose={() => setSpendOpen(null)} refetchEvents={fetchEvents} />
                      </div>
                    )}
                    {marketingOpen === ev.id && (
                      <div onClick={e => e.stopPropagation()} style={{ padding: '0 12px' }}>
                        <EventMarketingSummary eventId={ev.id} onClose={() => setMarketingOpen(null)} />
                      </div>
                    )}

                    {/* Action toolbar */}
                    <div style={{
                      display: 'flex', marginTop: 10,
                      borderTop: '1px solid var(--cream2)',
                    }} onClick={e => e.stopPropagation()}>
                      {[
                        { id: 'workers', icon: '👤', label: 'Who worked', onTap: () => setWorkersOpen(wOpen ? null : ev.id) },
                        ...(isAdmin ? [{ id: 'marketing', icon: '📊', label: 'Marketing', onTap: () => setMarketingOpen(marketingOpen === ev.id ? null : ev.id) }] : []),
                        ...(isAdmin ? [{ id: 'spend', icon: '💰', label: 'Ad spend', onTap: () => setSpendOpen(spendOpen === ev.id ? null : ev.id) }] : []),
                        { id: 'notes',   icon: '📝', label: 'Notes',      onTap: () => setNotesEvent(ev) },
                        { id: 'pdf',     icon: '⤓',  label: 'Download PDF', onTap: () => downloadPdf(ev) },
                      ].map((btn, i, arr) => (
                        <button key={btn.id} onClick={e => { e.stopPropagation(); btn.onTap() }} style={{
                          flex: 1, background: 'none', border: 'none',
                          borderRight: i < arr.length - 1 ? '1px solid var(--cream2)' : 'none',
                          padding: '11px 0', cursor: 'pointer',
                          minHeight: 44, position: 'relative',
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                          color: (btn as any).danger ? 'var(--red)' : 'var(--ash)',
                        }}>
                          <div style={{ fontSize: 13, lineHeight: 1 }}>{btn.icon}</div>
                          <div style={{ fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                            {btn.label}
                            {btn.id === 'notes' && noteCount > 0 && (
                              <span style={{
                                background: 'var(--green-pale)', color: 'var(--green-dark)',
                                fontSize: 10, padding: '1px 6px', borderRadius: 8,
                              }}>{noteCount}</span>
                            )}
                          </div>
                          {btn.id === 'notes' && noteCount === 0 && (
                            <span aria-hidden style={{
                              position: 'absolute', top: 6, right: 12,
                              width: 7, height: 7, borderRadius: '50%',
                              background: 'var(--amber)',
                            }} />
                          )}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )
          }

          /* ───── Desktop card — mobile-style collapsible ───── */
          const expanded = expandedCards.has(ev.id)
          const statusText = cur ? 'Current' : upcoming ? 'Upcoming' : 'Past'
          const statusColor = cur ? 'var(--green)' : upcoming ? 'var(--amber)' : 'var(--silver)'
          const noteCount = noteCounts[ev.id] || 0

          return (
            <div key={ev.id} style={{
              background: 'var(--card-bg)',
              border: '1.5px solid var(--pearl)',
              borderRadius: 16,
              overflow: 'hidden',
              marginBottom: 12,
              opacity: stale ? 0.7 : 1,
              transition: 'box-shadow .15s',
            }}
              onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,.07)' }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none' }}>

              {/* Themed gradient header — clicks toggle expand/collapse */}
              <div onClick={() => toggleCard(ev.id)} style={{
                background: 'var(--gradient-primary)',
                padding: '14px 20px',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 14,
                transition: 'filter .12s',
              }}
                onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(1.08)' }}
                onMouseLeave={e => { e.currentTarget.style.filter = 'none' }}>
                <span aria-hidden style={{
                  color: 'rgba(255,255,255,.5)', fontSize: 14, lineHeight: 1,
                  transition: 'transform .2s',
                  transform: expanded ? 'rotate(90deg)' : 'none',
                  display: 'inline-block', flexShrink: 0, width: 14,
                }}>▸</span>
                <span style={{
                  flex: 1, fontSize: 17, fontWeight: 900, color: '#fff',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
                }}>
                  {ev.store_name}
                </span>
                <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                  {[1, 2, 3].map(d => {
                    const day = ev.days.find((x: any) => x.day_number === d)
                    const has = !!day && ((day.purchases || 0) > 0 || (day.dollars10 || 0) > 0 || (day.dollars5 || 0) > 0)
                    return (
                      <span key={d} aria-hidden style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: has ? 'var(--green3)' : 'rgba(255,255,255,.3)',
                      }} />
                    )
                  })}
                </div>
                <span style={{
                  fontSize: 18, fontWeight: 800,
                  color: dollars > 0 ? 'var(--green3)' : 'rgba(255,255,255,.35)',
                  flexShrink: 0, minWidth: 90, textAlign: 'right',
                }}>
                  {dollars > 0 ? fmtDollars(dollars) : '—'}
                </span>
                <span aria-hidden style={{
                  color: 'rgba(255,255,255,.4)', fontSize: 14, flexShrink: 0,
                }}>▾</span>
              </div>

              {expanded && (
                <>
                  {/* Meta line */}
                  <div onClick={() => setDetail(ev)} style={{
                    padding: '10px 20px 0', fontSize: 12, color: 'var(--silver)', cursor: 'pointer',
                  }}>
                    {store?.city}{store?.state ? ', ' + store.state : ''} · {fmtRange(ev.start_date)}
                    <span style={{ color: statusColor, fontWeight: 700 }}> · {statusText}</span>
                  </div>

                  {/* Avatar stack + buyer first names */}
                  {evWorkers.length > 0 && (
                    <div onClick={() => setDetail(ev)} style={{
                      padding: '10px 20px 0', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                    }}>
                      <div style={{ display: 'flex' }}>
                        {evWorkers.map((w, i) => (
                          <div key={w.id} title={w.name} style={{
                            width: 30, height: 30, borderRadius: '50%',
                            background: getAvatarColor(w.id),
                            color: '#fff', fontWeight: 800, fontSize: 10,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            border: '2px solid #fff',
                            marginLeft: i === 0 ? 0 : -8, flexShrink: 0,
                          }}>{getInitials(w.name)}</div>
                        ))}
                      </div>
                      <div style={{
                        fontSize: 13, fontWeight: 500, color: 'var(--ash)',
                        flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {evWorkers.map((w: any) => (w.name || '').split(/\s+/)[0]).filter(Boolean).join(', ')}
                      </div>
                    </div>
                  )}

                  {/* Day cards */}
                  <div style={{ padding: '12px 20px 0', display: 'flex', gap: 8 }} onClick={e => e.stopPropagation()}>
                    {[1, 2, 3].map(d => {
                      const day = (ev.days || []).find((x: any) => x.day_number === d)
                      const dayDollars = day ? (Number(day.dollars10) || 0) + (Number(day.dollars5) || 0) : 0
                      const dayPurch = day ? Number(day.purchases) || 0 : 0
                      const hasData = !!day && (dayDollars > 0 || dayPurch > 0 || (Number(day.customers) || 0) > 0)
                      const dayDate = new Date(ev.start_date + 'T12:00:00')
                      dayDate.setDate(dayDate.getDate() + d - 1)
                      const isToday = dayDate.toISOString().split('T')[0] === todayISO

                      const onClick = (e: React.MouseEvent) => { e.stopPropagation(); openDayEntry(ev, d) }
                      if (hasData) {
                        return (
                          <button key={d} onClick={onClick} style={{
                            flex: 1, background: '#fff', border: '2px solid var(--green)',
                            borderRadius: 12, padding: '10px 8px', textAlign: 'center', cursor: 'pointer',
                            fontFamily: 'inherit', transition: 'background .12s',
                          }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'var(--green-pale)' }}
                            onMouseLeave={e => { e.currentTarget.style.background = '#fff' }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--green)', marginBottom: 2 }}>Day {d}</div>
                            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--green)', lineHeight: 1.1 }}>{fmtDollars(dayDollars)}</div>
                            <div style={{ fontSize: 11, color: 'var(--silver)', marginTop: 2 }}>{dayPurch} purch</div>
                          </button>
                        )
                      }
                      return (
                        <button key={d} onClick={onClick} style={{
                          flex: 1, background: 'var(--cream2)', border: '2px solid transparent',
                          borderRadius: 12, padding: '10px 8px', textAlign: 'center', cursor: 'pointer',
                          fontFamily: 'inherit', transition: 'background .12s',
                        }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'var(--pearl)' }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'var(--cream2)' }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fog)', marginBottom: 2 }}>Day {d}</div>
                          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--fog)', lineHeight: 1.1 }}>—</div>
                          <div style={{ fontSize: 11, color: 'var(--fog)', marginTop: 2, minHeight: 14 }}>{isToday ? 'today' : ''}</div>
                        </button>
                      )
                    })}
                  </div>

                  {/* Inline worker / spend expand panels */}
                  {wOpen && (
                    <div onClick={e => e.stopPropagation()} style={{ padding: '14px 20px 0' }}>
                      <div style={{ background: 'var(--cream)', border: '1px solid var(--pearl)', borderRadius: 10, padding: 14 }}>
                        <div className="fl">Who Worked This Event{!isAdmin && ' (read only)'}</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginTop: 8 }}>
                          {(isAdmin ? buyers : buyers.filter(b => evWorkers.some(w => w.id === b.id))).map(b => {
                            const on = evWorkers.some(w => w.id === b.id)
                            return (
                              <div key={b.id} onClick={isAdmin ? () => toggleWorker(ev, b.id, b.name) : undefined}
                                style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: isAdmin ? 'pointer' : 'default', fontSize: 14, padding: '4px 0' }}>
                                {isAdmin && (
                                  <div style={{
                                    width: 26, height: 26, borderRadius: 6, flexShrink: 0,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    ...(on ? { background: 'var(--green)' } : { border: '2.5px solid var(--pearl)' }),
                                  }}>
                                    {on && <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 12.5 C6 12.5, 8 17, 9.5 19 C12 14, 16 8, 20 5" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                                  </div>
                                )}
                                <span style={{ fontWeight: on ? 700 : 400, color: on ? 'var(--green-dark)' : 'var(--ash)' }}>{b.name}</span>
                              </div>
                            )
                          })}
                          {!isAdmin && evWorkers.length === 0 && (
                            <div style={{ fontSize: 13, color: 'var(--mist)', fontStyle: 'italic', gridColumn: '1 / -1' }}>No workers assigned yet.</div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                  {spendOpen === ev.id && (
                    <div onClick={e => e.stopPropagation()} style={{ padding: '14px 20px 0' }}>
                      <SpendPanel ev={ev} onClose={() => setSpendOpen(null)} refetchEvents={fetchEvents} />
                    </div>
                  )}
                  {marketingOpen === ev.id && (
                    <div onClick={e => e.stopPropagation()} style={{ padding: '14px 20px 0' }}>
                      <EventMarketingSummary eventId={ev.id} onClose={() => setMarketingOpen(null)} />
                    </div>
                  )}

                  {/* Action bar */}
                  <div style={{
                    marginTop: 14, padding: '10px 14px',
                    borderTop: '1px solid var(--cream2)',
                    display: 'flex',
                  }} onClick={e => e.stopPropagation()}>
                    {[
                      { id: 'workers', icon: '👤', label: 'Who worked', onTap: () => setWorkersOpen(wOpen ? null : ev.id) },
                      ...(isAdmin ? [{ id: 'marketing', icon: '📊', label: 'Marketing', onTap: () => setMarketingOpen(marketingOpen === ev.id ? null : ev.id) }] : []),
                      ...(isAdmin ? [{ id: 'spend', icon: '💰', label: 'Ad spend', onTap: () => setSpendOpen(spendOpen === ev.id ? null : ev.id) }] : []),
                      { id: 'notes',   icon: '📝', label: 'Notes',      onTap: () => setNotesEvent(ev) },
                      { id: 'pdf',     icon: '⤓',  label: 'Download PDF', onTap: () => downloadPdf(ev) },
                    ].map(btn => (
                      <button key={btn.id} onClick={e => { e.stopPropagation(); btn.onTap() }} style={{
                        flex: 1, background: 'transparent', border: 'none',
                        padding: '8px 0', cursor: 'pointer',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                        borderRadius: 8, position: 'relative',
                        color: (btn as any).danger ? 'var(--red)' : 'var(--silver)',
                        fontFamily: 'inherit',
                        transition: 'background .12s',
                      }}
                        onMouseEnter={e => { e.currentTarget.style.background = (btn as any).danger ? 'var(--red-pale)' : 'var(--cream)' }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                        <div style={{ fontSize: 18, lineHeight: 1 }}>{btn.icon}</div>
                        <div style={{ fontSize: 10, fontWeight: 600 }}>{btn.label}</div>
                        {btn.id === 'notes' && noteCount > 0 && (
                          <span aria-hidden style={{
                            position: 'absolute', top: 4, right: 'calc(50% - 22px)',
                            width: 8, height: 8, borderRadius: '50%',
                            background: 'var(--amber)',
                          }} />
                        )}
                      </button>
                    ))}
                  </div>
                </>
              )}
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
            <div style={{ color: 'var(--green3)', fontSize: 14 }}>◆ Event Details</div>
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(ev.workers || []).map((w: any) => (
                  <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className="badge badge-jade">{w.name}</span>
                    {!w.id?.startsWith('deleted_') && (
                      <NotificationStatusBadge eventId={ev.id} buyerId={w.id} compact />
                    )}
                  </div>
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

