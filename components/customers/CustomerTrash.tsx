'use client'

// Admin-only trash view for soft-deleted customers. Shows when each
// was deleted and offers Restore (clears deleted_at) or Permanently
// Delete (hard delete via the standard Supabase row delete — RLS
// admin policy allows it). Records older than 30 days are visually
// flagged as "auto-purge soon" — actual auto-purge cron lands in a
// later phase.

import { useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import type { Customer } from '@/lib/customers/types'
import type { Store } from '@/types'
import { fmtPhone, fmtDateLong } from '@/lib/customers/format'

const AUTO_PURGE_DAYS = 30

export default function CustomerTrash({
  storeId, stores, setStoreId, customers, loading, onChanged,
}: {
  storeId: string
  stores: Store[]
  setStoreId: (id: string) => void
  customers: Customer[]
  loading: boolean
  onChanged: () => void
}) {
  // customers is already filtered upstream to deleted_at IS NOT NULL.
  const sorted = useMemo(
    () => [...customers].sort((a, b) => (b.deleted_at || '').localeCompare(a.deleted_at || '')),
    [customers],
  )

  async function restore(c: Customer) {
    const { error } = await supabase.from('customers')
      .update({ deleted_at: null }).eq('id', c.id)
    if (error) { alert('Restore failed: ' + error.message); return }
    onChanged()
  }
  async function purge(c: Customer) {
    if (!confirm(`Permanently delete ${c.first_name} ${c.last_name}? This cannot be undone.`)) return
    const { error } = await supabase.from('customers').delete().eq('id', c.id)
    if (error) { alert('Permanent delete failed: ' + error.message); return }
    onChanged()
  }

  return (
    <>
      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
        <label className="fl">Store</label>
        <select value={storeId} onChange={e => setStoreId(e.target.value)} style={{ maxWidth: 360 }}>
          {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 6 }}>
          Soft-deleted customers stay restorable for {AUTO_PURGE_DAYS} days. Older rows are flagged for auto-purge (cron lands in a later phase).
        </div>
      </div>

      {loading ? (
        <div className="card" style={{ padding: 24, color: 'var(--mist)' }}>Loading…</div>
      ) : sorted.length === 0 ? (
        <div className="card" style={{ padding: 24, color: 'var(--mist)', textAlign: 'center' }}>
          Trash is empty for this store.
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--cream2)' }}>
                <th style={th}>Name</th>
                <th style={th}>Phone</th>
                <th style={th}>Email</th>
                <th style={th}>Deleted</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(c => {
                const ageDays = c.deleted_at
                  ? Math.floor((Date.now() - new Date(c.deleted_at).getTime()) / 86_400_000)
                  : 0
                const stale = ageDays > AUTO_PURGE_DAYS
                return (
                  <tr key={c.id} style={{ borderTop: '1px solid var(--cream2)' }}>
                    <td style={td}>
                      <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{c.last_name}, {c.first_name}</span>
                    </td>
                    <td style={td}>{fmtPhone(c.phone)}</td>
                    <td style={td}>{c.email || ''}</td>
                    <td style={td}>
                      {c.deleted_at ? fmtDateLong(c.deleted_at.slice(0, 10)) : '—'}
                      {stale && (
                        <span style={{
                          marginLeft: 6, fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 99,
                          background: 'var(--red-pale)', color: '#7f1d1d', textTransform: 'uppercase', letterSpacing: '.05em',
                        }}>auto-purge soon</span>
                      )}
                      <div style={{ fontSize: 10, color: 'var(--mist)' }}>{ageDays}d ago</div>
                    </td>
                    <td style={td}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button className="btn-outline btn-xs" onClick={() => restore(c)}>Restore</button>
                        <button className="btn-danger btn-xs" onClick={() => purge(c)}>Delete forever</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

const th: React.CSSProperties = {
  padding: '10px 12px', fontSize: 11, fontWeight: 800,
  color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.06em',
  textAlign: 'left',
}
const td: React.CSSProperties = {
  padding: '10px 12px', fontSize: 13, color: 'var(--ink)',
}
