'use client'

import { useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type { Event } from '@/types'

type Filter = 'all' | 'current' | 'past' | 'future'
type Sort = 'date-desc' | 'date-asc' | 'name-asc'

export default function Events() {
  const { events, stores, users, user, reload } = useApp()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('date-desc')
  const [showForm, setShowForm] = useState(false)
  const [newEvent, setNewEvent] = useState({ store_id: '', start_date: '' })
  const [saving, setSaving] = useState(false)
  const [workersOpen, setWorkersOpen] = useState<string | null>(null)

  const today = new Date(); today.setHours(0,0,0,0)
  const weekMs = 7 * 24 * 60 * 60 * 1000
  const buyers = users.filter(u => u.active && u.role !== 'non_buyer_admin' && u.role !== 'pending')

  const filtered = events.filter(ev => {
    if (!ev.start_date) return false
    const d = new Date(ev.start_date + 'T12:00:00')
    const diff = d.getTime() - today.getTime()
    if (filter === 'current') return diff >= -weekMs && diff <= weekMs
    if (filter === 'past') return diff < -weekMs
    if (filter === 'future') return diff > weekMs
    return true
  }).sort((a, b) => {
    if (sort === 'date-desc') return b.start_date.localeCompare(a.start_date)
    if (sort === 'date-asc') return a.start_date.localeCompare(b.start_date)
    return (a.store_name || '').localeCompare(b.store_name || '')
  })

  const createEvent = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newEvent.store_id || !newEvent.start_date) return
    setSaving(true)
    const store = stores.find(s => s.id === newEvent.store_id)
    await supabase.from('events').insert({
      store_id: newEvent.store_id, store_name: store?.name || '',
      start_date: newEvent.start_date, created_by: user?.id,
    })
    setSaving(false)
    setShowForm(false)
    setNewEvent({ store_id: '', start_date: '' })
    reload()
  }

  const deleteEvent = async (id: string) => {
    if (!confirm('Delete this event? This cannot be undone.')) return
    await supabase.from('events').delete().eq('id', id)
    reload()
  }

  const toggleWorker = async (ev: Event, uid: string, name: string) => {
    const workers = ev.workers || []
    const exists = workers.find(w => w.id === uid)
    const updated = exists ? workers.filter(w => w.id !== uid) : [...workers, { id: uid, name }]
    await supabase.from('events').update({ workers: updated }).eq('id', ev.id)
    reload()
  }

  const copyLink = (ev: Event) => {
    navigator.clipboard.writeText(`${window.location.origin}/event/${ev.id}`)
    alert('Event summary link copied to clipboard!')
  }

  const isCurrent = (ev: Event) => {
    const diff = new Date(ev.start_date + 'T12:00:00').getTime() - today.getTime()
    return diff >= -weekMs && diff <= weekMs
  }

  const fmt = (ds: string) => new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-black" style={{ color: 'var(--ink)' }}>
          Events <span className="text-base font-normal" style={{ color: 'var(--fog)' }}>({filtered.length} of {events.length})</span>
        </h1>
        <div className="flex gap-2 flex-wrap">
          <select value={filter} onChange={e => setFilter(e.target.value as Filter)}
            className="px-3 py-2 rounded-lg text-sm border"
            style={{ background: 'var(--card-bg)', borderColor: 'var(--pearl)', color: 'var(--ink)' }}>
            <option value="all">All Events</option>
            <option value="current">Current (±1 week)</option>
            <option value="future">Upcoming</option>
            <option value="past">Past</option>
          </select>
          <select value={sort} onChange={e => setSort(e.target.value as Sort)}
            className="px-3 py-2 rounded-lg text-sm border"
            style={{ background: 'var(--card-bg)', borderColor: 'var(--pearl)', color: 'var(--ink)' }}>
            <option value="date-desc">Newest First</option>
            <option value="date-asc">Oldest First</option>
            <option value="name-asc">Store Name</option>
          </select>
          {isAdmin && (
            <button onClick={() => setShowForm(true)} className="btn-primary btn-sm">+ New Event</button>
          )}
        </div>
      </div>

      {showForm && (
        <div className="rounded-xl p-5 mb-6" style={{ background: 'var(--card-bg)', border: '2px solid var(--green)' }}>
          <h3 className="font-black text-base mb-4" style={{ color: 'var(--ink)' }}>New Event</h3>
          <form onSubmit={createEvent} className="flex gap-3 flex-wrap items-end">
            <div>
              <label className="fl">Store</label>
              <select value={newEvent.store_id} onChange={e => setNewEvent(p => ({ ...p, store_id: e.target.value }))} required
                className="px-3 py-2.5 rounded-lg text-sm border"
                style={{ background: 'var(--cream2)', borderColor: 'var(--pearl)', color: 'var(--ink)', minWidth: 200 }}>
                <option value="">Select store…</option>
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="fl">Start Date</label>
              <input type="date" value={newEvent.start_date} onChange={e => setNewEvent(p => ({ ...p, start_date: e.target.value }))} required
                className="px-3 py-2.5 rounded-lg text-sm border"
                style={{ background: 'var(--cream2)', borderColor: 'var(--pearl)', color: 'var(--ink)' }} />
            </div>
            <div className="flex gap-2">
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

          return (
            <div key={ev.id} className="rounded-xl p-5"
              style={{ background: 'var(--card-bg)', border: `1px solid ${cur ? 'var(--green)' : 'var(--pearl)'}`, boxShadow: cur ? '0 0 0 2px var(--green-pale)' : 'none' }}>

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
                      {evWorkers.map(w => (
                        <span key={w.id} className="px-2 py-0.5 rounded-full text-xs font-bold"
                          style={{ background: 'var(--green-pale)', color: 'var(--green-dark)', border: '1px solid var(--green3)' }}>
                          👤 {w.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-4">
                  {[{ label: 'Days', value: ev.days.length }, { label: 'Purchases', value: purchases }, { label: 'Revenue', value: `$${(dollars/1000).toFixed(1)}k` }].map(({ label, value }) => (
                    <div key={label} className="text-center">
                      <div className="text-xl font-black" style={{ color: 'var(--green)' }}>{value}</div>
                      <div className="text-xs" style={{ color: 'var(--mist)' }}>{label}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Day dots */}
              <div className="flex gap-2 mt-4">
                {[1, 2, 3].map(d => {
                  const day = ev.days.find(x => x.day_number === d)
                  return (
                    <div key={d} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                      style={{ background: day ? 'var(--green-pale)' : 'var(--cream2)', color: day ? 'var(--green-dark)' : 'var(--silver)', border: `1px solid ${day ? 'var(--green3)' : 'transparent'}` }}>
                      {day ? '●' : '○'} Day {d}
                      {day && <span className="ml-1 opacity-70">{day.purchases} buys</span>}
                    </div>
                  )
                })}
              </div>

              {wOpen && (
                <div className="mt-4 p-4 rounded-xl" style={{ background: 'var(--cream2)', border: '1px solid var(--pearl)' }}>
                  <div className="fl">Who Worked This Event</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {buyers.map(b => {
                      const on = evWorkers.some(w => w.id === b.id)
                      return (
                        <label key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14 }}>
                          <input type="checkbox" checked={on}
                            onChange={() => toggleWorker(ev, b.id, b.name)}
                            style={{ width: 16, height: 16, accentColor: 'var(--green)', cursor: 'pointer' }} />
                          <span style={{ fontWeight: on ? 700 : 400, color: on ? 'var(--green-dark)' : 'var(--ash)' }}>{b.name}</span>
                          <span style={{ fontSize: 12, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{b.role}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 mt-3 pt-3 flex-wrap" style={{ borderTop: '1px solid var(--cream2)' }}>
                <button onClick={() => setWorkersOpen(wOpen ? null : ev.id)}
                  className={wOpen ? 'btn-ghost btn-xs' : 'btn-outline btn-xs'}>
                  👤 Who Worked
                </button>
                <button onClick={() => copyLink(ev)} className="btn-outline btn-xs">
                  🔗 Copy Link
                </button>
                {isAdmin && (
                  <button onClick={() => deleteEvent(ev.id)} className="btn-danger btn-xs">Delete</button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
