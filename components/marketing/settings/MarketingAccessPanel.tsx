'use client'

// Per-user marketing_access toggle. Lists every active portal user with
// a checkbox; flipping it writes to users.marketing_access immediately
// (optimistic update with rollback on error).
//
// Superadmin-only — the parent MarketingSettings shell already gates
// this; the RLS policy on users would need to be permissive enough to
// let superadmins update other users' rows. The existing AdminPanel
// pattern proves that's already the case.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { User } from '@/types'

export default function MarketingAccessPanel() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('users')
        .select('id, name, email, role, active, marketing_access')
        .eq('active', true)
        .order('name')
      if (!cancelled) {
        setUsers((data ?? []) as User[])
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  async function toggle(userId: string, next: boolean) {
    setBusyId(userId)
    // Optimistic update
    setUsers(p => p.map(u => u.id === userId ? { ...u, marketing_access: next } : u))
    const { error } = await supabase
      .from('users')
      .update({ marketing_access: next })
      .eq('id', userId)
    if (error) {
      alert('Failed to update: ' + error.message)
      // Rollback
      setUsers(p => p.map(u => u.id === userId ? { ...u, marketing_access: !next } : u))
    }
    setBusyId(null)
  }

  const filtered = users.filter(u => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return (u.name || '').toLowerCase().includes(q)
        || (u.email || '').toLowerCase().includes(q)
  })

  const grantedCount = users.filter(u => u.marketing_access).length

  if (loading) return <div className="card" style={{ padding: 16, color: 'var(--mist)' }}>Loading users…</div>

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>Marketing Access</div>
          <div style={{ fontSize: 12, color: 'var(--mist)' }}>
            {grantedCount} of {users.length} active users have access.
          </div>
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search name or email…"
          style={{ width: 220, fontSize: 13 }} />
      </div>

      <div style={{ border: '1px solid var(--pearl)', borderRadius: 8, overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 12, fontSize: 13, color: 'var(--mist)' }}>No matches.</div>
        ) : filtered.map((u, i) => {
          const granted = !!u.marketing_access
          return (
            <label key={u.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 14px',
              borderBottom: i < filtered.length - 1 ? '1px solid var(--cream2)' : 'none',
              cursor: busyId === u.id ? 'wait' : 'pointer',
              background: granted ? 'var(--green-pale)' : '#fff',
            }}>
              <input type="checkbox" checked={granted}
                disabled={busyId === u.id}
                onChange={e => toggle(u.id, e.target.checked)}
                style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }} />
              <span aria-hidden style={{
                width: 20, height: 20, flexShrink: 0, borderRadius: 5,
                border: `2px solid ${granted ? 'var(--green)' : 'var(--pearl)'}`,
                background: granted ? 'var(--green)' : '#FFFFFF',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#FFFFFF', fontSize: 13, fontWeight: 900, lineHeight: 1,
              }}>{granted ? '✓' : ''}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
                  {u.name || u.email}
                  {u.role === 'superadmin' && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: 'var(--cream2)', color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.05em' }}>superadmin</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--mist)' }}>{u.email}</div>
              </div>
            </label>
          )
        })}
      </div>

      <div style={{ marginTop: 10, fontSize: 11, color: 'var(--mist)', fontStyle: 'italic' }}>
        Tip: external Collected Concepts users get marketing access without any other portal permissions.
        Create their account first (Admin Panel → Users), then toggle them on here.
      </div>
    </div>
  )
}
