'use client'

// Per-user inventory_access toggle. Lists every active portal user
// with a checkbox; flipping it writes to users.inventory_access
// immediately (optimistic update with rollback on error).
//
// Mirrors components/marketing/settings/MarketingAccessPanel.tsx —
// same pattern, same protections. Gated to superadmin by the
// parent (AdminPanel).
//
// A user who has inventory_access=true sees the Inventory
// Management sidebar item and can open the wholesale module
// regardless of their role. Admin / superadmin / partner already
// have access by default; this toggle is for everyone else.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { User } from '@/types'
import Checkbox from '@/components/ui/Checkbox'

export default function InventoryAccessPanel() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('users')
        .select('id, name, email, role, active, is_partner, inventory_access')
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
    // Optimistic update — the toggle response is immediate; we
    // revert if the DB write fails.
    setUsers(p => p.map(u => u.id === userId ? { ...u, inventory_access: next } : u))
    const { error } = await supabase
      .from('users')
      .update({ inventory_access: next })
      .eq('id', userId)
    if (error) {
      alert('Failed to update: ' + error.message)
      setUsers(p => p.map(u => u.id === userId ? { ...u, inventory_access: !next } : u))
    }
    setBusyId(null)
  }

  const filtered = users.filter(u => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return (u.name || '').toLowerCase().includes(q)
        || (u.email || '').toLowerCase().includes(q)
  })

  const grantedCount = users.filter(u => u.inventory_access).length

  if (loading) return <div className="card" style={{ padding: 16, color: 'var(--mist)' }}>Loading users…</div>

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>Inventory Access</div>
          <div style={{ fontSize: 12, color: 'var(--mist)' }}>
            {grantedCount} of {users.length} active users have explicit access.
          </div>
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search name or email…"
          style={{ width: 220, fontSize: 13 }} />
      </div>

      <div style={{ fontSize: 11, color: 'var(--mist)', marginBottom: 10, lineHeight: 1.5 }}>
        Toggle on for any user who needs the Inventory Management module without an admin / partner role.
        Admins, superadmins, and partners already have access by default and don't need this flag — the
        toggle is harmless on them but a no-op.
      </div>

      <div style={{ border: '1px solid var(--pearl)', borderRadius: 8, overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 12, fontSize: 13, color: 'var(--mist)' }}>No matches.</div>
        ) : filtered.map((u, i) => {
          const granted = !!u.inventory_access
          // Show a subtle "already has access via role" hint so the
          // operator knows the toggle is redundant. Doesn't disable
          // the checkbox — keep it flippable.
          const builtIn = u.role === 'superadmin' || u.role === 'admin' || !!u.is_partner
          return (
            <Checkbox
              key={u.id}
              checked={granted}
              disabled={busyId === u.id}
              onChange={(next) => toggle(u.id, next)}
              size={20}
              label={
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
                    {u.name || u.email}
                    {u.role === 'superadmin' && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: 'var(--cream2)', color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.05em' }}>superadmin</span>}
                    {u.role === 'admin' && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: 'var(--cream2)', color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.05em' }}>admin</span>}
                    {u.is_partner && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: 'var(--cream2)', color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.05em' }}>partner</span>}
                    {builtIn && (
                      <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 600, color: 'var(--green-dark)', fontStyle: 'italic' }}>
                        — already has access via role
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--mist)' }}>{u.email}</div>
                </div>
              }
              labelStyle={{
                display: 'flex', width: '100%', gap: 12, padding: '10px 14px',
                borderBottom: i < filtered.length - 1 ? '1px solid var(--cream2)' : 'none',
                background: granted ? 'var(--green-pale)' : '#fff',
              }}
            />
          )
        })}
      </div>
    </div>
  )
}
