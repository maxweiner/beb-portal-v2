'use client'

import { useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'

const CARRIERS: Record<string, string> = {
  '1Z': 'UPS', 'UPS': 'UPS',
  '9400': 'USPS', '9205': 'USPS', '9361': 'USPS', '94': 'USPS',
  '7489': 'FedEx', '7490': 'FedEx', '6129': 'FedEx', 'FDX': 'FedEx',
  'DHL': 'DHL',
}

function detectCarrier(tracking: string): string {
  const t = tracking.toUpperCase().replace(/\s/g, '')
  for (const [prefix, carrier] of Object.entries(CARRIERS)) {
    if (t.startsWith(prefix)) return carrier
  }
  return 'Other'
}

export default function Shipping() {
  const { shipments, user, reload, brand } = useApp()
  const [form, setForm] = useState({ tracking: '', description: '', from_store: '', ship_date: new Date().toISOString().slice(0,10) })
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.tracking) return
    await supabase.auth.refreshSession()
    setSaving(true)
    const carrier = detectCarrier(form.tracking)
    const { error } = await supabase.from('shipments').insert({ brand,
      ...form, carrier, created_by: user?.id,
    })
    setSaving(false)
    if (error) { alert(error.message); return }
    setForm({ tracking: '', description: '', from_store: '', ship_date: new Date().toISOString().slice(0,10) })
    reload()
  }

  const carrierColor: Record<string, string> = {
    UPS: '#F5A623', FedEx: '#7B0BFF', USPS: '#1668BC', DHL: '#FFCC00', Other: '#6B7280'
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-black mb-6" style={{ color: 'var(--ink)' }}>Shipping Log</h1>

      {/* Add form */}
      <div className="rounded-xl p-5 mb-6" style={{ background: 'var(--card-bg)', border: '1px solid var(--pearl)' }}>
        <h3 className="font-black text-sm mb-4 uppercase tracking-wide" style={{ color: 'var(--mist)' }}>Log a Shipment</h3>
        <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4">
          <div className="col-span-2 md:col-span-1">
            <label className="fl">Tracking Number *</label>
            <input value={form.tracking} onChange={e => setForm(p => ({ ...p, tracking: e.target.value }))} required
              placeholder="Auto-detects carrier"
              className="w-full px-3 py-2.5 rounded-lg text-sm"
              style={{ background: 'var(--cream2)', border: '1px solid var(--pearl)', color: 'var(--ink)' }} />
            {form.tracking && (
              <div className="text-xs mt-1 font-semibold" style={{ color: carrierColor[detectCarrier(form.tracking)] || 'var(--mist)' }}>
                {detectCarrier(form.tracking)} detected
              </div>
            )}
          </div>
          <div>
            <label className="fl">Ship Date</label>
            <input type="date" value={form.ship_date} onChange={e => setForm(p => ({ ...p, ship_date: e.target.value }))}
              className="w-full px-3 py-2.5 rounded-lg text-sm"
              style={{ background: 'var(--cream2)', border: '1px solid var(--pearl)', color: 'var(--ink)' }} />
          </div>
          <div>
            <label className="fl">From Store</label>
            <input value={form.from_store} onChange={e => setForm(p => ({ ...p, from_store: e.target.value }))}
              placeholder="Store name"
              className="w-full px-3 py-2.5 rounded-lg text-sm"
              style={{ background: 'var(--cream2)', border: '1px solid var(--pearl)', color: 'var(--ink)' }} />
          </div>
          <div>
            <label className="fl">Description</label>
            <input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
              placeholder="Jewelry, documents…"
              className="w-full px-3 py-2.5 rounded-lg text-sm"
              style={{ background: 'var(--cream2)', border: '1px solid var(--pearl)', color: 'var(--ink)' }} />
          </div>
          <div className="col-span-2">
            <button type="submit" disabled={saving || !form.tracking}
              className="btn-primary"
              >{saving ? 'Logging…' : 'Log Shipment'}</button>
          </div>
        </form>
      </div>

      {/* Shipments list */}
      <div className="space-y-2">
        {shipments.length === 0 && (
          <div className="text-center py-12" style={{ color: 'var(--mist)' }}>
            <div className="text-4xl mb-3">⬡</div>
            <div className="font-bold">No shipments logged yet</div>
          </div>
        )}
        {shipments.map(s => (
          <div key={s.id} className="rounded-xl px-5 py-4 flex items-center gap-4"
            style={{ background: 'var(--card-bg)', border: '1px solid var(--pearl)' }}>
            <div className="text-xs font-black px-2 py-1 rounded" style={{ background: carrierColor[s.carrier] || '#6B7280', color: s.carrier === 'DHL' ? '#000' : '#fff', minWidth: 48, textAlign: 'center' }}>
              {s.carrier}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-mono text-sm font-bold" style={{ color: 'var(--ink)' }}>{s.tracking}</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--mist)' }}>
                {s.ship_date} {s.from_store ? `· From: ${s.from_store}` : ''} {s.description ? `· ${s.description}` : ''}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
