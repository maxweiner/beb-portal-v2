'use client'

// Manage marketing_payment_methods — saved card LABELS only. Card
// numbers are NEVER stored. The actual charging happens outside the
// portal (Collected runs the card themselves).
//
// Phase 1 seeded "Max Amex 6006" + "Max Citibank 6795" per spec.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface PaymentMethod {
  id: string
  label: string
  is_archived: boolean
  last_used_at: string | null
}

export default function PaymentMethodsPanel() {
  const [rows, setRows] = useState<PaymentMethod[]>([])
  const [loading, setLoading] = useState(true)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [showArchived, setShowArchived] = useState(false)

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('marketing_payment_methods')
      .select('id, label, is_archived, last_used_at')
      .order('is_archived')
      .order('label')
    setRows((data ?? []) as PaymentMethod[])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function add() {
    const l = label.trim()
    if (!l) { alert('Enter a label.'); return }
    setBusy(true)
    const { error } = await supabase.from('marketing_payment_methods').insert({ label: l })
    if (error) alert('Failed to add: ' + error.message)
    else { setLabel(''); await load() }
    setBusy(false)
  }

  async function setArchived(id: string, next: boolean) {
    const { error } = await supabase.from('marketing_payment_methods').update({ is_archived: next }).eq('id', id)
    if (error) { alert('Failed: ' + error.message); return }
    setRows(p => p.map(r => r.id === id ? { ...r, is_archived: next } : r))
  }

  if (loading) return <div className="card" style={{ padding: 16, color: 'var(--mist)' }}>Loading…</div>

  const visible = rows.filter(r => showArchived || !r.is_archived)

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)', marginBottom: 4 }}>Payment Method Labels</div>
      <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 14 }}>
        Labels only — never card numbers. Approvers pick from active labels when authorizing payment;
        archived labels stay on historical records but disappear from the dropdown.
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input type="text" value={label} onChange={e => setLabel(e.target.value)}
          placeholder='e.g. "Joe Visa 1234"' style={{ flex: 1, fontSize: 13 }} />
        <button className="btn-primary btn-sm" onClick={add} disabled={!label.trim() || busy}>
          {busy ? '…' : '+ Add Label'}
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <label style={{ fontSize: 12, color: 'var(--ash)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)}
            style={{ width: 16, height: 16, margin: 0 }} />
          Show archived
        </label>
      </div>

      {visible.length === 0 ? (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--mist)', fontSize: 13, background: 'var(--cream2)', borderRadius: 8 }}>
          {rows.length === 0 ? 'No payment methods yet.' : 'No active labels (toggle "Show archived" to view).'}
        </div>
      ) : (
        <div style={{ border: '1px solid var(--pearl)', borderRadius: 8, overflow: 'hidden' }}>
          {visible.map((r, i) => (
            <div key={r.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 14px',
              borderBottom: i < visible.length - 1 ? '1px solid var(--cream2)' : 'none',
              background: r.is_archived ? 'var(--cream2)' : '#fff',
              opacity: r.is_archived ? 0.65 : 1,
            }}>
              <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
                💳 {r.label}
                {r.is_archived && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: 'var(--pearl)', color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.05em' }}>archived</span>}
              </div>
              {r.last_used_at && (
                <div style={{ fontSize: 11, color: 'var(--mist)' }}>
                  Last used {new Date(r.last_used_at).toLocaleDateString()}
                </div>
              )}
              <button onClick={() => setArchived(r.id, !r.is_archived)} className="btn-outline btn-xs">
                {r.is_archived ? 'Unarchive' : 'Archive'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
