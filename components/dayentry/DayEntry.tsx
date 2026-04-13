'use client'

import { useState, useEffect } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type { Event, EventDay } from '@/types'

export default function DayEntry() {
  const { events, stores, users, user, reload } = useApp()
  const [selectedEventId, setSelectedEventId] = useState('')
  const [selectedDay, setSelectedDay] = useState(1)
  const [existing, setExisting] = useState<EventDay | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [form, setForm] = useState({
    customers: '', purchases: '', dollars10: '', dollars5: '',
    src_vdp: '', src_postcard: '', src_social: '',
    src_wordofmouth: '', src_other: '', src_repeat: '',
  })

  const today = new Date(); today.setHours(0,0,0,0)
  const weekMs = 7 * 24 * 60 * 60 * 1000

  const activeEvents = events.filter(ev => {
    if (!ev.start_date) return false
    const d = new Date(ev.start_date + 'T12:00:00')
    return (d.getTime() - today.getTime()) >= -weekMs && (d.getTime() - today.getTime()) <= weekMs
  })

  const selectedEvent = events.find(e => e.id === selectedEventId)

  useEffect(() => {
    if (!selectedEvent) return
    const day = selectedEvent.days.find(d => d.day_number === selectedDay)
    if (day) {
      setExisting(day)
      setForm({
        customers: String(day.customers || ''),
        purchases: String(day.purchases || ''),
        dollars10: String(day.dollars10 || ''),
        dollars5:  String(day.dollars5  || ''),
        src_vdp:         String(day.src_vdp         || ''),
        src_postcard:    String(day.src_postcard    || ''),
        src_social:      String(day.src_social      || ''),
        src_wordofmouth: String(day.src_wordofmouth || ''),
        src_other:       String(day.src_other       || ''),
        src_repeat:      String(day.src_repeat      || ''),
      })
    } else {
      setExisting(null)
      setForm({ customers: '', purchases: '', dollars10: '', dollars5: '',
        src_vdp: '', src_postcard: '', src_social: '',
        src_wordofmouth: '', src_other: '', src_repeat: '' })
    }
  }, [selectedEventId, selectedDay, events])

  const n = (v: string) => parseInt(v) || 0

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedEvent) return
    if (!n(form.purchases) && !n(form.dollars10)) {
      alert('Enter at least purchases and dollar amount.')
      return
    }
    setSaving(true)

    const payload = {
      event_id: selectedEventId,
      day_number: selectedDay,
      customers: n(form.customers),
      purchases: n(form.purchases),
      dollars10: n(form.dollars10),
      dollars5:  n(form.dollars5),
      src_vdp:         n(form.src_vdp),
      src_postcard:    n(form.src_postcard),
      src_social:      n(form.src_social),
      src_wordofmouth: n(form.src_wordofmouth),
      src_other:       n(form.src_other),
      src_repeat:      n(form.src_repeat),
      entered_by: user?.id,
      entered_by_name: user?.name,
      entered_at: new Date().toISOString(),
    }

    if (existing) {
      await supabase.from('event_days').update(payload).eq('id', existing.id)
    } else {
      await supabase.from('event_days').insert(payload)
    }

    // Fire email notification (non-blocking)
    fetch('/api/day-entry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_id: selectedEventId, day_number: selectedDay, entered_by_name: user?.name }),
    }).catch(() => {}) // silently ignore email errors

    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
    reload()
  }

  const field = (label: string, key: keyof typeof form, hint?: string) => (
    <div>
      <label className="fl">{label}</label>
      <input type="number" min="0" value={form[key]}
        onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
        placeholder="0"
        className="w-full px-3 py-2.5 rounded-lg text-sm"
        style={{ background: 'var(--cream2)', border: '1px solid var(--pearl)', color: 'var(--ink)' }} />
      {hint && <div className="text-xs mt-1" style={{ color: 'var(--silver)' }}>{hint}</div>}
    </div>
  )

  const formatDate = (ev: Event, dayNum: number) => {
    const d = new Date(ev.start_date + 'T12:00:00')
    d.setDate(d.getDate() + dayNum - 1)
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-black mb-6" style={{ color: 'var(--ink)' }}>Enter Day Data</h1>

      {/* Event + Day selector */}
      <div className="rounded-xl p-5 mb-6" style={{ background: 'var(--card-bg)', border: '1px solid var(--pearl)' }}>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="fl">Event</label>
            <select value={selectedEventId} onChange={e => { setSelectedEventId(e.target.value); setSelectedDay(1) }}
              className="w-full px-3 py-2.5 rounded-lg text-sm"
              style={{ background: 'var(--cream2)', border: '1px solid var(--pearl)', color: 'var(--ink)' }}>
              <option value="">Select event…</option>
              {activeEvents.map(ev => (
                <option key={ev.id} value={ev.id}>{ev.store_name} — {ev.start_date}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="fl">Day</label>
            <select value={selectedDay} onChange={e => setSelectedDay(Number(e.target.value))}
              disabled={!selectedEvent}
              className="w-full px-3 py-2.5 rounded-lg text-sm disabled:opacity-40"
              style={{ background: 'var(--cream2)', border: '1px solid var(--pearl)', color: 'var(--ink)' }}>
              {[1, 2, 3].map(d => (
                <option key={d} value={d}>
                  Day {d}{selectedEvent ? ` — ${formatDate(selectedEvent, d)}` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
        {existing && (
          <div className="mt-3 px-3 py-2 rounded-lg text-xs font-semibold notice-gold notice">
            ✎ Editing existing entry — last saved {existing.entered_by_name ? `by ${existing.entered_by_name}` : ''} {existing.entered_at ? new Date(existing.entered_at).toLocaleDateString() : ''}
          </div>
        )}
      </div>

      {selectedEvent ? (
        <form onSubmit={handleSubmit}>
          {/* Main stats */}
          <div className="rounded-xl p-5 mb-4" style={{ background: 'var(--card-bg)', border: '1px solid var(--pearl)' }}>
            <div className="font-black text-sm mb-4 uppercase tracking-wide" style={{ color: 'var(--mist)' }}>Sales Data</div>
            <div className="grid grid-cols-2 gap-4">
              {field('Customers Seen', 'customers')}
              {field('Purchases Made', 'purchases', 'Required')}
              {field('Commission at 10%', 'dollars10', 'Required')}
              {field('Commission at 5%', 'dollars5')}
            </div>
          </div>

          {/* Lead sources */}
          <div className="rounded-xl p-5 mb-6" style={{ background: 'var(--card-bg)', border: '1px solid var(--pearl)' }}>
            <div className="font-black text-sm mb-4 uppercase tracking-wide" style={{ color: 'var(--mist)' }}>Lead Sources</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {field('VDP / Large Postcard', 'src_vdp')}
              {field('Store Postcard', 'src_postcard')}
              {field('Social Media', 'src_social')}
              {field('Word of Mouth', 'src_wordofmouth')}
              {field('Repeat Customer', 'src_repeat')}
              {field('Other', 'src_other')}
            </div>
          </div>

          <button type="submit" disabled={saving || !selectedEventId}
            className="btn-primary btn-full" style={{ textAlign: "center", justifyContent: "center" }}
            style={{ background: saved ? '#22c55e' : 'var(--green)' }}>
            {saving ? 'Saving…' : saved ? '✓ Saved!' : existing ? 'Update Day Data' : 'Submit Day Data'}
          </button>
        </form>
      ) : (
        <div className="text-center py-12" style={{ color: 'var(--mist)' }}>
          <div className="text-4xl mb-3">✎</div>
          <div className="font-bold">Select an event to enter data</div>
          {activeEvents.length === 0 && (
            <div className="text-sm mt-2">No active events found within the past/next week.</div>
          )}
        </div>
      )}
    </div>
  )
}
