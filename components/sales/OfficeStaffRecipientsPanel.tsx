'use client'

// Settings card: configure who gets notified when a sales rep
// submits a special request on a trunk show. Two paths:
//   1. Pick a BEB Portal user (uses their portal email)
//   2. Add an external email (no user account)
// Toggle is_active to mute someone temporarily without removing.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import {
  listRecipients, addUserRecipient, addEmailRecipient,
  setActive, removeRecipient,
  type OfficeStaffRecipient,
} from '@/lib/sales/officeStaff'

export default function OfficeStaffRecipientsPanel() {
  const { users } = useApp()
  const [rows, setRows] = useState<OfficeStaffRecipient[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pickedUserId, setPickedUserId] = useState('')
  const [emailText, setEmailText] = useState('')
  const [busy, setBusy] = useState(false)

  async function reload() {
    setError(null)
    try { setRows(await listRecipients()) }
    catch (err: any) { setError(err?.message || 'Failed to load') }
    setLoaded(true)
  }
  useEffect(() => { void reload() }, [])

  const usersById = useMemo(() => new Map(users.map(u => [u.id, u])), [users])
  const eligibleUsers = useMemo(() => {
    const taken = new Set(rows.map(r => r.user_id).filter(Boolean) as string[])
    return users
      .filter(u => u.active !== false && u.role !== 'pending')
      .filter(u => !taken.has(u.id))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  }, [users, rows])

  async function addUser() {
    if (!pickedUserId || busy) return
    setBusy(true); setError(null)
    try {
      await addUserRecipient(pickedUserId)
      setPickedUserId('')
      await reload()
    } catch (e: any) { setError(e?.message || 'Could not add') }
    setBusy(false)
  }
  async function addEmail() {
    const e = emailText.trim()
    if (!e || busy) return
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { setError('That email looks off.'); return }
    setBusy(true); setError(null)
    try {
      await addEmailRecipient(e)
      setEmailText('')
      await reload()
    } catch (err: any) { setError(err?.message || 'Could not add') }
    setBusy(false)
  }
  async function toggle(r: OfficeStaffRecipient) {
    try { await setActive(r.id, !r.is_active); setRows(p => p.map(x => x.id === r.id ? { ...x, is_active: !r.is_active } : x)) }
    catch (e: any) { alert(e?.message || 'Could not update') }
  }
  async function remove(r: OfficeStaffRecipient) {
    if (!confirm('Remove this recipient?')) return
    try { await removeRecipient(r.id); setRows(p => p.filter(x => x.id !== r.id)) }
    catch (e: any) { alert(e?.message || 'Could not remove') }
  }

  return (
    <div>
      {error && (
        <div style={{ background: '#FEE2E2', color: '#991B1B', padding: '8px 10px', borderRadius: 6, fontSize: 13, marginBottom: 10 }}>{error}</div>
      )}

      {/* Add user */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={pickedUserId} onChange={e => setPickedUserId(e.target.value)}
          style={{ flex: 1, minWidth: 200 }}>
          <option value="">Add a portal user…</option>
          {eligibleUsers.map(u => (
            <option key={u.id} value={u.id}>{u.name} · {u.email}</option>
          ))}
        </select>
        <button onClick={addUser} disabled={!pickedUserId || busy} className="btn-primary btn-sm">+ Add user</button>
      </div>

      {/* Add external email */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={emailText} onChange={e => setEmailText(e.target.value)}
          placeholder="Or add an external email (e.g. office@example.com)"
          type="email"
          onKeyDown={e => { if (e.key === 'Enter') addEmail() }}
          style={{ flex: 1, minWidth: 200 }} />
        <button onClick={addEmail} disabled={!emailText.trim() || busy} className="btn-primary btn-sm">+ Add email</button>
      </div>

      {!loaded ? (
        <div style={{ padding: 14, textAlign: 'center', color: 'var(--mist)', fontSize: 13 }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 14, textAlign: 'center', color: 'var(--mist)', fontSize: 13, fontStyle: 'italic' }}>
          No recipients yet — special requests won't email anyone until you add at least one.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {rows.map(r => {
            const u = r.user_id ? usersById.get(r.user_id) : null
            return (
              <div key={r.id} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 10px',
                background: r.is_active ? 'var(--cream)' : 'var(--cream2)',
                borderRadius: 6,
                opacity: r.is_active ? 1 : 0.7,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
                    {u ? u.name : (r.email || '(empty)')}
                    {u && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: 'var(--mist)', textTransform: 'uppercase' }}>portal user</span>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--mist)' }}>{u?.email || r.email || ''}</div>
                </div>
                <button onClick={() => toggle(r)} className="btn-outline btn-xs">
                  {r.is_active ? 'Mute' : 'Unmute'}
                </button>
                <button onClick={() => remove(r)} aria-label="Remove" title="Remove"
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--mist)', fontSize: 16 }}>×</button>
              </div>
            )
          })}
        </div>
      )}

      <div style={{ marginTop: 10, fontSize: 11, color: 'var(--mist)' }}>
        In-app notifications for these recipients are deferred to a follow-up; emails are sent immediately on submit.
      </div>
    </div>
  )
}
