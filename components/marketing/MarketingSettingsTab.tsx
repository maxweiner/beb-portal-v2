'use client'

// Superadmin-only Marketing settings: manage payment methods + types.
// Both lists are CRUDable (rename, archive, reorder, add). Archived
// rows stay in the DB so historical payments keep their FK; they just
// drop out of the new-payment dropdowns.

import { useEffect, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'

interface LookupRow {
  id: string
  label: string
  active: boolean
  sort_order: number
}

export default function MarketingSettingsTab() {
  const { user } = useApp()
  const isSuperAdmin = user?.role === 'superadmin'

  if (!isSuperAdmin) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="card text-center" style={{ padding: 40 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
          <div className="font-bold" style={{ color: 'var(--ink)' }}>Superadmins only</div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6" style={{ maxWidth: 800, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)', marginBottom: 4 }}>Marketing settings</h1>
      <p style={{ fontSize: 13, color: 'var(--mist)', marginBottom: 18 }}>
        Manage the lists that power the payment form. Both are global — Beneficial and Liberty share them.
      </p>

      <LookupSection
        title="Payment methods"
        table="marketing_payment_methods"
        addPlaceholder={`e.g. "John's Visa", "Sarah's Amex"`}
      />

      <div style={{ height: 18 }} />

      <LookupSection
        title="Advertising types"
        table="marketing_payment_types"
        addPlaceholder='e.g. "Digital Ads", "Radio"'
      />
    </div>
  )
}

function LookupSection({ title, table, addPlaceholder }: {
  title: string
  table: 'marketing_payment_methods' | 'marketing_payment_types'
  addPlaceholder: string
}) {
  const [rows, setRows] = useState<LookupRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')

  const reload = async () => {
    const { data } = await supabase.from(table).select('*').order('sort_order').order('label')
    setRows((data || []) as LookupRow[])
    setLoaded(true)
  }
  useEffect(() => { reload() /* eslint-disable-next-line */ }, [table])

  async function add() {
    const label = newLabel.trim()
    if (!label) return
    setAdding(true)
    const nextOrder = (rows.reduce((m, r) => Math.max(m, r.sort_order), 0) || 0) + 1
    const { error } = await supabase.from(table).insert({ label, sort_order: nextOrder })
    setAdding(false)
    if (error) { alert('Add failed: ' + error.message); return }
    setNewLabel('')
    reload()
  }

  async function rename(id: string) {
    const label = editLabel.trim()
    if (!label) { setEditingId(null); return }
    const { error } = await supabase.from(table).update({ label, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) { alert('Save failed: ' + error.message); return }
    setEditingId(null)
    reload()
  }

  async function toggleActive(r: LookupRow) {
    const { error } = await supabase.from(table).update({ active: !r.active, updated_at: new Date().toISOString() }).eq('id', r.id)
    if (error) { alert('Failed: ' + error.message); return }
    reload()
  }

  async function move(r: LookupRow, dir: -1 | 1) {
    const idx = rows.findIndex(x => x.id === r.id)
    const swap = rows[idx + dir]
    if (!swap) return
    const updates = [
      supabase.from(table).update({ sort_order: swap.sort_order }).eq('id', r.id),
      supabase.from(table).update({ sort_order: r.sort_order }).eq('id', swap.id),
    ]
    await Promise.all(updates)
    reload()
  }

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--pearl)', background: 'var(--cream2)' }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink)' }}>{title}</div>
      </div>
      <div>
        {!loaded ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--mist)' }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--mist)' }}>None yet.</div>
        ) : rows.map((r, i) => (
          <div key={r.id} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 16px', borderBottom: '1px solid var(--cream2)',
            opacity: r.active ? 1 : 0.5,
          }}>
            <button onClick={() => move(r, -1)} disabled={i === 0} title="Move up"
              style={{ background: 'none', border: 'none', cursor: i === 0 ? 'default' : 'pointer', color: 'var(--mist)', padding: 2, fontFamily: 'inherit' }}>↑</button>
            <button onClick={() => move(r, 1)} disabled={i === rows.length - 1} title="Move down"
              style={{ background: 'none', border: 'none', cursor: i === rows.length - 1 ? 'default' : 'pointer', color: 'var(--mist)', padding: 2, fontFamily: 'inherit' }}>↓</button>
            {editingId === r.id ? (
              <>
                <input value={editLabel} onChange={e => setEditLabel(e.target.value)}
                  autoFocus
                  onKeyDown={e => {
                    if (e.key === 'Enter') rename(r.id)
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  style={{ flex: 1, fontSize: 13 }} />
                <button onClick={() => rename(r.id)} className="btn-primary btn-sm">Save</button>
                <button onClick={() => setEditingId(null)} className="btn-outline btn-sm">×</button>
              </>
            ) : (
              <>
                <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--ink)', fontWeight: 600 }}>{r.label}</div>
                {!r.active && (
                  <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--mist)', background: 'var(--cream2)', padding: '1px 6px', borderRadius: 4, textTransform: 'uppercase' }}>archived</span>
                )}
                <button onClick={() => { setEditingId(r.id); setEditLabel(r.label) }} className="btn-outline btn-sm">Edit</button>
                <button onClick={() => toggleActive(r)} className="btn-outline btn-sm">
                  {r.active ? 'Archive' : 'Restore'}
                </button>
              </>
            )}
          </div>
        ))}

        <div style={{ display: 'flex', gap: 8, padding: '12px 16px', background: 'var(--cream)' }}>
          <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') add() }}
            placeholder={addPlaceholder}
            style={{ flex: 1, fontSize: 13 }} />
          <button onClick={add} disabled={adding || !newLabel.trim()} className="btn-primary btn-sm">+ Add</button>
        </div>
      </div>
    </div>
  )
}
