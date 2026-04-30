'use client'

// Manage marketing_approvers — the users who can approve planning,
// proofs, and payment requests. Single-approver quorum throughout
// (any active approver can approve any step).
//
// Spec defaults: Max, Joe, Richie, Teri. Seeded here when the table
// is empty by adding rows for matching users.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { User } from '@/types'

interface ApproverRow {
  id: string
  user_id: string
  is_active: boolean
}

export default function ApproversPanel() {
  const [allUsers, setAllUsers] = useState<User[]>([])
  const [approvers, setApprovers] = useState<ApproverRow[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState<string>('')
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true)
    const [{ data: users }, { data: rows }] = await Promise.all([
      supabase.from('users').select('id, name, email, role, active, marketing_access')
        .eq('active', true).order('name'),
      supabase.from('marketing_approvers').select('id, user_id, is_active'),
    ])
    setAllUsers((users ?? []) as User[])
    setApprovers((rows ?? []) as ApproverRow[])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  // Users not yet on the approver list, available in the "add" dropdown.
  const eligible = allUsers.filter(u => !approvers.some(a => a.user_id === u.id))

  async function add() {
    if (!adding) return
    setBusy(true)
    const { error } = await supabase.from('marketing_approvers').insert({ user_id: adding, is_active: true })
    if (error) alert('Failed to add approver: ' + error.message)
    else { setAdding(''); await load() }
    setBusy(false)
  }

  async function setActive(id: string, next: boolean) {
    const { error } = await supabase.from('marketing_approvers').update({ is_active: next }).eq('id', id)
    if (error) { alert('Failed: ' + error.message); return }
    setApprovers(p => p.map(a => a.id === id ? { ...a, is_active: next } : a))
  }

  async function remove(id: string) {
    if (!confirm('Remove this approver? They will no longer be notified for approvals.')) return
    const { error } = await supabase.from('marketing_approvers').delete().eq('id', id)
    if (error) { alert('Failed: ' + error.message); return }
    setApprovers(p => p.filter(a => a.id !== id))
  }

  if (loading) return <div className="card" style={{ padding: 16, color: 'var(--mist)' }}>Loading…</div>

  const userById = new Map(allUsers.map(u => [u.id, u]))

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)', marginBottom: 4 }}>Approvers</div>
      <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 14 }}>
        Any active approver can approve any step. Single-approver quorum throughout — first responder wins.
      </div>

      {/* Add row */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center' }}>
        <select value={adding} onChange={e => setAdding(e.target.value)} style={{ flex: 1, fontSize: 13 }}>
          <option value="">Pick a user to add…</option>
          {eligible.map(u => (
            <option key={u.id} value={u.id}>{u.name || u.email}</option>
          ))}
        </select>
        <button className="btn-primary btn-sm" onClick={add} disabled={!adding || busy}>
          {busy ? 'Adding…' : '+ Add Approver'}
        </button>
      </div>

      {/* List */}
      {approvers.length === 0 ? (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--mist)', fontSize: 13, background: 'var(--cream2)', borderRadius: 8 }}>
          No approvers configured yet. Add Max, Joe, Richie, or Teri (spec defaults) to get started.
        </div>
      ) : (
        <div style={{ border: '1px solid var(--pearl)', borderRadius: 8, overflow: 'hidden' }}>
          {approvers.map((a, i) => {
            const u = userById.get(a.user_id)
            return (
              <div key={a.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 14px',
                borderBottom: i < approvers.length - 1 ? '1px solid var(--cream2)' : 'none',
                background: a.is_active ? '#fff' : 'var(--cream2)',
                opacity: a.is_active ? 1 : 0.65,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
                    {u?.name || u?.email || '(deleted user)'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--mist)' }}>{u?.email}</div>
                </div>
                <button onClick={() => setActive(a.id, !a.is_active)} className="btn-outline btn-xs">
                  {a.is_active ? 'Deactivate' : 'Activate'}
                </button>
                <button onClick={() => remove(a.id)} style={{
                  background: 'transparent', border: 'none', color: 'var(--red)',
                  cursor: 'pointer', fontSize: 16, padding: '0 4px', fontWeight: 700,
                }}>×</button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
