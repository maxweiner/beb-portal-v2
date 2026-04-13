'use client'

import { useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'

export default function Historical() {
  const { stores, user, reload } = useApp()
  const [form, setForm] = useState({
    store_id: '', start_date: '', day: '1',
    customers: '', purchases: '', dollars10: '', dollars5: '',
    src_vdp: '', src_postcard: '', src_social: '',
    src_wordofmouth: '', src_other: '', src_repeat: '',
  })
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  const n = (v: string) => parseInt(v) || 0

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.store_id || !form.start_date) return
    setSaving(true)

    // Find or create the event
    let eventId: string
    const { data: existing } = await supabase
      .from('events')
      .select('id')
      .eq('store_id', form.store_id)
      .eq('start_date', form.start_date)
      .maybeSingle()

    if (existing) {
      eventId = existing.id
    } else {
      const store = stores.find(s => s.id === form.store_id)
      const { data: newEv, error } = await supabase
        .from('events')
        .insert({ store_id: form.store_id, store_name: store?.name || '', start_date: form.start_date, created_by: user?.id })
        .select('id')
        .single()
      if (error) { alert(error.message); setSaving(false); return }
      eventId = newEv.id
    }

    // Upsert the day
    const payload = {
      event_id: eventId,
      day_number: n(form.day),
      customers: n(form.customers), purchases: n(form.purchases),
      dollars10: n(form.dollars10), dollars5: n(form.dollars5),
      src_vdp: n(form.src_vdp), src_postcard: n(form.src_postcard),
      src_social: n(form.src_social), src_wordofmouth: n(form.src_wordofmouth),
      src_other: n(form.src_other), src_repeat: n(form.src_repeat),
      entered_by: user?.id, entered_by_name: user?.name,
      entered_at: new Date().toISOString(),
    }

    const { data: existingDay } = await supabase
      .from('event_days')
      .select('id')
      .eq('event_id', eventId)
      .eq('day_number', n(form.day))
      .maybeSingle()

    if (existingDay) {
      await supabase.from('event_days').update(payload).eq('id', existingDay.id)
    } else {
      await supabase.from('event_days').insert(payload)
    }

    setSaving(false)
    setDone(true)
    reload()
  }

  if (done) return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="rounded-xl p-8 text-center" style={{ background: 'var(--card-bg)', border: '1px solid var(--pearl)' }}>
        <div className="text-4xl mb-3">✅</div>
        <div className="font-black text-lg mb-2" style={{ color: 'var(--ink)' }}>Historical data saved!</div>
        <button onClick={() => { setDone(false); setForm({ store_id: '', start_date: '', day: '1', customers: '', purchases: '', dollars10: '', dollars5: '', src_vdp: '', src_postcard: '', src_social: '', src_wordofmouth: '', src_other: '', src_repeat: '' }) }}
          className="btn-primary"
          >Enter More</button>
      </div>
    </div>
  )

  const field = (label: string, key: keyof typeof form) => (
    <div>
      <label className="block text-xs font-bold mb-1 uppercase tracking-wide" style={{ color: 'var(--mist)' }}>{label}</label>
      <input type="number" min="0" value={form[key]} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} placeholder="0"
        className="w-full px-3 py-2 rounded-lg text-sm"
        style={{ background: 'var(--cream2)', border: '1px solid var(--pearl)', color: 'var(--ink)' }} />
    </div>
  )

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-black mb-2" style={{ color: 'var(--ink)' }}>Historical Data Entry</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--mist)' }}>Enter data for past events. An event will be created automatically if it doesn't exist.</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="card">
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-bold mb-1 uppercase tracking-wide" style={{ color: 'var(--mist)' }}>Store *</label>
              <select value={form.store_id} onChange={e => setForm(p => ({ ...p, store_id: e.target.value }))} required
                className="w-full px-3 py-2.5 rounded-lg text-sm"
                style={{ background: 'var(--cream2)', border: '1px solid var(--pearl)', color: 'var(--ink)' }}>
                <option value="">Select store…</option>
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold mb-1 uppercase tracking-wide" style={{ color: 'var(--mist)' }}>Day</label>
              <select value={form.day} onChange={e => setForm(p => ({ ...p, day: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-lg text-sm"
                style={{ background: 'var(--cream2)', border: '1px solid var(--pearl)', color: 'var(--ink)' }}>
                <option value="1">Day 1</option>
                <option value="2">Day 2</option>
                <option value="3">Day 3</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold mb-1 uppercase tracking-wide" style={{ color: 'var(--mist)' }}>Event Start Date *</label>
              <input type="date" value={form.start_date} onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))} required
                className="w-full px-3 py-2.5 rounded-lg text-sm"
                style={{ background: 'var(--cream2)', border: '1px solid var(--pearl)', color: 'var(--ink)' }} />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="text-xs font-black uppercase tracking-wide mb-3" style={{ color: 'var(--mist)' }}>Sales</div>
          <div className="grid grid-cols-2 gap-4">
            {field('Customers', 'customers')}
            {field('Purchases', 'purchases')}
            {field('× $10 Bills', 'dollars10')}
            {field('× $5 Bills', 'dollars5')}
          </div>
        </div>

        <div className="card">
          <div className="text-xs font-black uppercase tracking-wide mb-3" style={{ color: 'var(--mist)' }}>Lead Sources</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {field('VDP / Large Postcard', 'src_vdp')}
            {field('Store Postcard', 'src_postcard')}
            {field('Social Media', 'src_social')}
            {field('Word of Mouth', 'src_wordofmouth')}
            {field('Repeat Customer', 'src_repeat')}
            {field('Other', 'src_other')}
          </div>
        </div>

        <button type="submit" disabled={saving || !form.store_id || !form.start_date}
          className="btn-primary btn-full"
          >{saving ? 'Saving…' : 'Save Historical Data'}</button>
      </form>
    </div>
  )
}
