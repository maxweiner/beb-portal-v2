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
  const [spendOpen, setSpendOpen] = useState<string | null>(null)
  const [detail, setDetail] = useState<Event | null>(null)

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
  const fmtDollars = (n: number) => `$${Math.round(n).toLocaleString()}`

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-black" style={{ color: 'var(--ink)' }}>
          Events <span className="text-base font-normal" style={{ color: 'var(--fog)' }}>({filtered.length} of {events.length})</span>
        </h1>
        <div className="flex gap-2 flex-wrap">
          <select value={filter} onChange={e => setFilter(e.target.value as Filter)}
            style={{ width: 'auto' }}>
            <option value="all">All Events</option>
            <option value="current">Current (±1 week)</option>
            <option value="future">Upcoming</option>
            <option value="past">Past</option>
          </select>
          <select value={sort} onChange={e => setSort(e.target.value as Sort)}
            style={{ width: 'auto' }}>
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

          return (
            <div key={ev.id} className="card"
              style={{ border: `1px solid ${cur ? 'var(--green)' : 'var(--pearl)'}`, boxShadow: cur ? '0 0 0 2px var(--green-pale)' : 'none', cursor: 'pointer' }}
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
                  {[
                    { label: 'Days', value: ev.days.length },
                    { label: 'Purchases', value: purchases },
                    { label: 'Revenue', value: fmtDollars(dollars) },
                  ].map(({ label, value }) => (
                    <div key={label} className="text-center">
                      <div className="text-xl font-black" style={{ color: 'var(--green)' }}>{value}</div>
                      <div className="text-xs" style={{ color: 'var(--mist)' }}>{label}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Day dots */}
              <div className="flex gap-2 mt-4" onClick={e => e.stopPropagation()}>
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

              {/* Workers panel */}
              {wOpen && (
                <div className="mt-4 p-4 rounded-xl" style={{ background: 'var(--cream2)', border: '1px solid var(--pearl)' }} onClick={e => e.stopPropagation()}>
                  <div className="fl">Who Worked This Event</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
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
              <div className="flex gap-2 mt-3 pt-3 flex-wrap" style={{ borderTop: '1px solid var(--cream2)' }} onClick={e => e.stopPropagation()}>
                <button onClick={e => { e.stopPropagation(); setWorkersOpen(wOpen ? null : ev.id) }}
                  className={wOpen ? 'btn-ghost btn-xs' : 'btn-outline btn-xs'}>
                  👤 Who Worked
                </button>
                <button onClick={e => { e.stopPropagation(); setSpendOpen(spendOpen === ev.id ? null : ev.id) }}
                  className={spendOpen === ev.id ? 'btn-ghost btn-xs' : 'btn-outline btn-xs'}>
                  💰 Ad Spend
                </button>
                <button onClick={e => { e.stopPropagation(); copyLink(ev) }} className="btn-outline btn-xs">
                  🔗 Copy Link
                </button>
                {isAdmin && (
                  <button onClick={e => { e.stopPropagation(); deleteEvent(ev.id) }} className="btn-danger btn-xs">Delete</button>
                )}
              </div>

              {/* Spend panel */}
              {spendOpen === ev.id && (
                <SpendPanel ev={ev} onClose={() => setSpendOpen(null)} reload={reload} />
              )}
            </div>
          )
        })}
      </div>

      {/* Detail Modal */}
      {detail && (
        <EventDetailModal ev={detail} stores={stores} onClose={() => setDetail(null)} fmtDollars={fmtDollars} />
      )}
    </div>
  )
}

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

        {/* Header */}
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

          {/* Summary stats */}
          <div className="card card-accent" style={{ margin: 0 }}>
            <div className="card-title">Event Summary</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {[
                ['Customers', totalCustomers.toLocaleString()],
                ['Purchases', totalPurchases.toLocaleString()],
                ['Close Rate', `${closeRate}%`],
                ['Revenue', fmtDollars(totalDollars)],
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

          {/* Per day breakdown */}
          {days.length > 0 && (
            <div className="card card-accent" style={{ margin: 0 }}>
              <div className="card-title">Day by Day</div>
              {days.map(d => {
                const dayDate = new Date(ev.start_date + 'T12:00:00')
                dayDate.setDate(dayDate.getDate() + d.day_number - 1)
                const dayDollars = (d.dollars10 || 0) + (d.dollars5 || 0)
                const dayCR = d.customers > 0 ? Math.round(d.purchases / d.customers * 100) : 0
                return (
                  <div key={d.day_number} style={{ paddingBottom: 16, marginBottom: 16, borderBottom: '1px solid var(--cream2)' }}>
                    <div style={{ fontWeight: 700, color: 'var(--green)', marginBottom: 8 }}>Day {d.day_number} — {fmt(dayDate.toISOString().slice(0, 10))}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, fontSize: 13 }}>
                      {[['Customers', d.customers || 0], ['Purchases', d.purchases || 0], ['Revenue', fmtDollars(dayDollars)], ['Close', `${dayCR}%`]].map(([l, v]) => (
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

          {/* Spend */}
          {(ev.spend_vdp || ev.spend_newspaper || ev.spend_postcard || ev.spend_spiffs) ? (
            <div className="card card-accent" style={{ margin: 0 }}>
              <div className="card-title">Ad Spend & Spiffs</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[
                  ['VDP Spend', ev.spend_vdp],
                  ['Newspaper Spend', ev.spend_newspaper],
                  ['Postcard Spend', ev.spend_postcard],
                  ['Spiffs Paid', ev.spend_spiffs],
                ].map(([label, value]) => value ? (
                  <div key={label as string}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--mist)', marginBottom: 2 }}>{label}</div>
                    <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--ink)' }}>${Math.round(Number(value)).toLocaleString()}</div>
                  </div>
                ) : null)}
              </div>
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--cream2)', fontSize: 13, fontWeight: 700, color: 'var(--mist)' }}>
                Total Spend: <span style={{ color: 'var(--ink)' }}>${Math.round((ev.spend_vdp || 0) + (ev.spend_newspaper || 0) + (ev.spend_postcard || 0) + (ev.spend_spiffs || 0)).toLocaleString()}</span>
              </div>
            </div>
          ) : null}

          {/* Workers */}
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

/* ── SPEND PANEL ── */
function SpendPanel({ ev, onClose, reload }: { ev: Event; onClose: () => void; reload: () => void }) {
  const [spend, setSpend] = useState({
    spend_vdp:       String(ev.spend_vdp       || ''),
    spend_newspaper: String(ev.spend_newspaper || ''),
    spend_postcard:  String(ev.spend_postcard  || ''),
    spend_spiffs:    String(ev.spend_spiffs    || ''),
  })
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    const { error } = await supabase.from('events').update({
      spend_vdp:       parseFloat(spend.spend_vdp)       || 0,
      spend_newspaper: parseFloat(spend.spend_newspaper) || 0,
      spend_postcard:  parseFloat(spend.spend_postcard)  || 0,
      spend_spiffs:    parseFloat(spend.spend_spiffs)    || 0,
    }).eq('id', ev.id)
    setSaving(false)
    if (error) { alert('Error: ' + error.message); return }
    reload()
    onClose()
  }

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
        <div className="fl" style={{ margin: 0 }}>Ad Spend & Spiffs</div>
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
        <button className="btn-primary btn-sm" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save Spend'}
        </button>
        <button className="btn-outline btn-sm" onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}
