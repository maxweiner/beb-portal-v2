'use client'

// Lightweight Create-Event modal. Mirrors the inline form on the
// legacy Events view (Events.tsx createEvent + form), trimmed to a
// modal so the new BuyingEventsView (Pre/During/Post tabs) can offer
// a "+ New Event" entry without yanking the user back to legacy.
//
// On success, calls onCreated with the new event id so the caller
// can refresh + scroll into view if it wants. Uses useApp().reload()
// so the global context picks the new row up immediately.

import { useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import DatePicker from '@/components/ui/DatePicker'

interface Props {
  /** When 'reserved', creates a tentative "Save the Date" event
   *  instead of a normal scheduled one. Mirrors the legacy form. */
  mode?: 'scheduled' | 'reserved'
  onClose: () => void
  onCreated?: (eventId: string) => void
}

export default function CreateEventModal({ mode = 'scheduled', onClose, onCreated }: Props) {
  const { stores, user, brand, reload } = useApp()
  const [storeId, setStoreId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [buyersNeeded, setBuyersNeeded] = useState('3')
  const [saving, setSaving] = useState(false)
  const [storeQuery, setStoreQuery] = useState('')

  const filteredStores = stores
    .filter(s => {
      if (!storeQuery.trim()) return true
      const q = storeQuery.trim().toLowerCase()
      return `${s.name} ${s.city || ''} ${s.state || ''}`.toLowerCase().includes(q)
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!storeId || !startDate) {
      alert('Pick a store and a start date.')
      return
    }
    const n = parseInt(buyersNeeded, 10)
    if (!Number.isFinite(n) || n < 1 || n > 20) {
      alert('Buyers needed must be between 1 and 20.')
      return
    }
    const store = stores.find(s => s.id === storeId)
    setSaving(true)
    try {
      const { data, error } = await supabase
        .from('events')
        .insert({
          brand,
          store_id: storeId,
          store_name: store?.name || '',
          start_date: startDate,
          buyers_needed: n,
          created_by: user?.id,
          status: mode === 'reserved' ? 'reserved' : 'scheduled',
        })
        .select()
        .single()
      if (error) { alert('Failed to create event: ' + error.message); return }
      reload()
      onCreated?.(data.id)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 999,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#fff', borderRadius: 12, width: 'min(540px, 100%)', maxHeight: '92vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,.3)',
          border: mode === 'reserved' ? '2px dashed #D97706' : 'none',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--cream2)' }}>
          <div style={{ fontSize: 18, fontWeight: 900 }}>
            {mode === 'reserved' ? '📌 Save the Date — Reserved Event' : '◆ New Buying Event'}
          </div>
          {mode === 'reserved' && (
            <div style={{ fontSize: 12, color: '#92400E', marginTop: 4 }}>
              Tentative — won't trigger normal notifications until promoted to Scheduled.
            </div>
          )}
        </div>

        <form onSubmit={submit} style={{ padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="fl">Store *</label>
            <input
              type="text"
              value={storeQuery}
              onChange={e => setStoreQuery(e.target.value)}
              placeholder="Search stores by name, city, state…"
              style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box', marginBottom: 6 }}
            />
            <select
              value={storeId}
              onChange={e => setStoreId(e.target.value)}
              required
              size={Math.min(8, Math.max(4, filteredStores.length))}
              style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box', height: 'auto' }}
            >
              {filteredStores.length === 0 && <option value="">No stores match.</option>}
              {filteredStores.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.city ? ` — ${s.city}${s.state ? ', ' + s.state : ''}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label className="fl">Start Date *</label>
            <DatePicker value={startDate} onChange={v => setStartDate(v)} />
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label className="fl">Buyers Needed *</label>
            <input
              type="number" min={1} max={20} step={1} required
              value={buyersNeeded}
              onChange={e => setBuyersNeeded(e.target.value)}
              style={{ width: 120 }}
            />
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" onClick={onClose} className="btn-outline">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Creating…' : (mode === 'reserved' ? 'Save the Date' : 'Create Event')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
