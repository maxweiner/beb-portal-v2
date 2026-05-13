'use client'

// Settings → 🤝 Expense Delegates card. Max-only (mounting in
// Settings.tsx is gated to max@bebllp.com; the POST/revoke API
// routes hard-reject anyone else). Lists active delegations,
// has an add-form (two user pickers), and offers a revoke button
// per row (soft-delete — the row stays for audit).
//
// Reads use the supabase client directly; RLS on expense_delegates
// permits Max to see all rows. Writes go through the API routes so
// the Max-only gate stays in one place.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface UserRow {
  id: string
  name: string
  email: string
  active: boolean
}

interface DelegateRow {
  id: string
  delegate_user_id: string
  principal_user_id: string
  created_at: string
  created_by: string | null
  revoked_at: string | null
}

interface DecoratedRow extends DelegateRow {
  delegate?: UserRow
  principal?: UserRow
  creator?: UserRow
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

export default function ExpenseDelegatesPanel() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [rows, setRows] = useState<DecoratedRow[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Add-form state
  const [delegateId, setDelegateId] = useState('')
  const [principalId, setPrincipalId] = useState('')

  async function reload() {
    setLoading(true)
    setError(null)
    try {
      const [uRes, dRes] = await Promise.all([
        supabase
          .from('users')
          .select('id, name, email, active')
          .eq('active', true)
          .order('name', { ascending: true }),
        supabase
          .from('expense_delegates')
          .select('id, delegate_user_id, principal_user_id, created_at, created_by, revoked_at')
          .order('created_at', { ascending: false }),
      ])
      if (uRes.error) throw uRes.error
      if (dRes.error) throw dRes.error

      const userList = (uRes.data || []) as UserRow[]
      const userById = new Map(userList.map(u => [u.id, u]))
      const rawRows = (dRes.data || []) as DelegateRow[]
      const decorated: DecoratedRow[] = rawRows.map(r => ({
        ...r,
        delegate: userById.get(r.delegate_user_id),
        principal: userById.get(r.principal_user_id),
        creator: r.created_by ? userById.get(r.created_by) : undefined,
      }))
      setUsers(userList)
      setRows(decorated)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void reload() }, [])

  async function handleAdd() {
    if (!delegateId || !principalId) {
      setError('Pick both a delegate and a principal.')
      return
    }
    if (delegateId === principalId) {
      setError('Delegate and principal must be different users.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/expense-delegates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || ''}`,
        },
        body: JSON.stringify({ delegateUserId: delegateId, principalUserId: principalId }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      setDelegateId('')
      setPrincipalId('')
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Add failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleRevoke(id: string, displayName: string) {
    const ok = confirm(
      `Revoke ${displayName}?\n\nThe row stays in the audit log — historical filings remain attributed.`,
    )
    if (!ok) return
    setBusy(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/api/expense-delegates/${id}/revoke`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token || ''}` },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Revoke failed')
    } finally {
      setBusy(false)
    }
  }

  const activeRows = rows.filter(r => !r.revoked_at)
  const historyRows = rows.filter(r => r.revoked_at)
  const userLabel = (u: UserRow | undefined, fallback: string) =>
    u ? `${u.name} (${u.email})` : fallback

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 13, color: 'var(--mist)', lineHeight: 1.5 }}>
        Pair a <strong>delegate</strong> (the person who submits) with a{' '}
        <strong>principal</strong> (the person who owns the report). The
        delegate sees a top-of-page "Submitting for:" picker inside the
        Expenses module — outside Expenses they stay themselves. Resulting
        reports are owned by the principal; the delegate appears only on a
        small "Submitted by …" audit line on the PDF.
      </div>

      {error && (
        <div style={{
          padding: 10, background: '#FEE2E2', color: '#991B1B',
          borderRadius: 6, fontSize: 13,
        }}>{error}</div>
      )}

      {/* Add form */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) auto',
        gap: 8,
        alignItems: 'end',
      }}>
        <div>
          <label style={{
            display: 'block', fontSize: 11, fontWeight: 700,
            textTransform: 'uppercase', color: 'var(--mist)', marginBottom: 4,
          }}>Delegate (submits)</label>
          <select
            value={delegateId}
            onChange={e => setDelegateId(e.target.value)}
            style={{ width: '100%', padding: '6px 8px', fontSize: 13 }}
            disabled={busy || loading}
          >
            <option value="">— Pick a user —</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
            ))}
          </select>
        </div>
        <div>
          <label style={{
            display: 'block', fontSize: 11, fontWeight: 700,
            textTransform: 'uppercase', color: 'var(--mist)', marginBottom: 4,
          }}>Principal (owner)</label>
          <select
            value={principalId}
            onChange={e => setPrincipalId(e.target.value)}
            style={{ width: '100%', padding: '6px 8px', fontSize: 13 }}
            disabled={busy || loading}
          >
            <option value="">— Pick a user —</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
            ))}
          </select>
        </div>
        <button
          onClick={handleAdd}
          disabled={busy || !delegateId || !principalId}
          className="btn-primary btn-sm"
        >
          {busy ? 'Saving…' : '+ Add'}
        </button>
      </div>

      {/* Active delegations */}
      <div>
        <div style={{
          fontSize: 12, fontWeight: 700, color: 'var(--ink)', marginBottom: 6,
        }}>
          Active delegations ({activeRows.length})
        </div>
        {loading ? (
          <div style={{ fontSize: 13, color: 'var(--mist)' }}>Loading…</div>
        ) : activeRows.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--mist)', fontStyle: 'italic' }}>
            None. Add the first pairing above.
          </div>
        ) : (
          <table style={{
            width: '100%', borderCollapse: 'collapse', fontSize: 13,
          }}>
            <thead>
              <tr style={{ background: 'var(--cream2)', textAlign: 'left' }}>
                <th style={{ padding: '6px 8px' }}>Delegate (submits)</th>
                <th style={{ padding: '6px 8px', width: 24 }} aria-hidden />
                <th style={{ padding: '6px 8px' }}>Principal (owner)</th>
                <th style={{ padding: '6px 8px', width: 110 }}>Created</th>
                <th style={{ padding: '6px 8px', width: 90 }} aria-label="actions" />
              </tr>
            </thead>
            <tbody>
              {activeRows.map(r => {
                const dName = r.delegate?.name ?? r.delegate_user_id
                const pName = r.principal?.name ?? r.principal_user_id
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--cream2)' }}>
                    <td style={{ padding: '6px 8px' }}>{userLabel(r.delegate, r.delegate_user_id)}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--mist)', textAlign: 'center' }}>→</td>
                    <td style={{ padding: '6px 8px' }}>{userLabel(r.principal, r.principal_user_id)}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--mist)', fontSize: 11 }}>{fmtDate(r.created_at)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                      <button
                        onClick={() => handleRevoke(r.id, `${dName} → ${pName}`)}
                        disabled={busy}
                        className="btn-outline btn-xs"
                      >Revoke</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Revoked history (collapsed by default) */}
      {historyRows.length > 0 && (
        <div>
          <button
            onClick={() => setShowHistory(s => !s)}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: 700, color: 'var(--mist)',
              padding: 0, marginBottom: 6,
            }}
          >
            {showHistory ? '▾' : '▸'} Revoked history ({historyRows.length})
          </button>
          {showHistory && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--cream2)', textAlign: 'left', color: 'var(--mist)' }}>
                  <th style={{ padding: '6px 8px' }}>Delegate</th>
                  <th style={{ padding: '6px 8px', width: 24 }} aria-hidden />
                  <th style={{ padding: '6px 8px' }}>Principal</th>
                  <th style={{ padding: '6px 8px', width: 110 }}>Created</th>
                  <th style={{ padding: '6px 8px', width: 110 }}>Revoked</th>
                </tr>
              </thead>
              <tbody>
                {historyRows.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--cream2)', color: 'var(--mist)' }}>
                    <td style={{ padding: '6px 8px' }}>{userLabel(r.delegate, r.delegate_user_id)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'center' }}>→</td>
                    <td style={{ padding: '6px 8px' }}>{userLabel(r.principal, r.principal_user_id)}</td>
                    <td style={{ padding: '6px 8px', fontSize: 11 }}>{fmtDate(r.created_at)}</td>
                    <td style={{ padding: '6px 8px', fontSize: 11 }}>{r.revoked_at ? fmtDate(r.revoked_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
