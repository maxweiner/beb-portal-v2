'use client'

// Per-user marketing_access toggle. Lists every active portal user with
// a checkbox; flipping it writes to users.marketing_access immediately
// (optimistic update with rollback on error).
//
// Superadmin-only — the parent MarketingSettings shell already gates
// this; the RLS policy on users would need to be permissive enough to
// let superadmins update other users' rows. The existing AdminPanel
// pattern proves that's already the case.

import { useEffect, useRef, useState } from 'react'
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
        Existing users above can be granted access with a single toggle. To create a brand-new external Collected account, use Invite below.
      </div>

      <InvitePartnerCard onInvited={() => {
        // Reload users so the new account appears in the list.
        ;(async () => {
          const { data } = await supabase.from('users')
            .select('id, name, email, role, active, marketing_access')
            .eq('active', true).order('name')
          setUsers((data ?? []) as User[])
        })()
      }} />
    </div>
  )
}

function InvitePartnerCard({ onInvited }: { onInvited: () => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const formRef = useRef<HTMLDivElement>(null)

  async function invite() {
    setBusy(true); setError(null); setResult(null)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token
      const res = await fetch('/api/marketing/users/invite-partner', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ name: name.trim(), email: email.trim() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error || `Failed (${res.status})`)
      } else {
        if (json.upgraded) {
          setResult(`✓ ${email} already had an account — upgraded to the marketing role.`)
        } else {
          setResult(`✓ Invite sent to ${email}. They'll receive a "set your password" email from Supabase.`)
        }
        setName(''); setEmail('')
        onInvited()
      }
    } catch (e: any) { setError(e?.message || 'Network error') }
    setBusy(false)
  }

  return (
    <div ref={formRef} style={{
      marginTop: 16, padding: 14,
      background: 'var(--cream2)', border: '1px solid var(--pearl)', borderRadius: 8,
    }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)', marginBottom: 4 }}>
        Invite a Marketing Team member
      </div>
      <div style={{ fontSize: 11, color: 'var(--mist)', marginBottom: 10 }}>
        Sends a Supabase "set your password" invite. The new account gets <code>role=marketing</code> and only sees Calendar + Marketing in the sidebar — no Day Entry, no Events, no other portal sections.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, alignItems: 'end' }}>
        <div>
          <label className="fl">Name</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder='e.g. "Joe at Collected"' style={{ fontSize: 13 }} />
        </div>
        <div>
          <label className="fl">Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="joe@collectedconcepts.com" style={{ fontSize: 13 }} />
        </div>
        <button className="btn-primary btn-sm" onClick={invite}
          disabled={busy || !email.trim() || !name.trim()}>
          {busy ? 'Inviting…' : '+ Invite'}
        </button>
      </div>

      {result && (
        <div style={{
          marginTop: 10,
          background: 'var(--green-pale)', color: 'var(--green-dark)',
          border: '1px solid var(--green3)', borderRadius: 6,
          padding: '8px 12px', fontSize: 12, fontWeight: 700,
        }}>{result}</div>
      )}
      {error && (
        <div style={{
          marginTop: 10,
          background: 'var(--red-pale)', color: '#7f1d1d',
          border: '1px solid #fecaca', borderRadius: 6,
          padding: '8px 12px', fontSize: 12,
        }}>{error}</div>
      )}
    </div>
  )
}
