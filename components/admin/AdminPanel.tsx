'use client'

import { useState, useEffect } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type { User, Role } from '@/types'

type Tab = 'users' | 'invite' | 'merge' | 'email' | 'sms' | 'events'

export default function AdminPanel() {
  const [tab, setTab] = useState<Tab>('users')
  const { user } = useApp()

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-black mb-6" style={{ color: 'var(--ink)' }}>Admin Panel</h1>

      {/* Tab bar */}
      <div className="tab-bar">
        {([
          ['users', 'Users & Roles'],
          ['invite', 'Invite User'],
          ['merge', 'Merge Users'],
          ['email', 'Email Settings'],
          ['sms', 'SMS Settings'],
          ['events', 'Events'],
        ] as [Tab, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`tab${tab === id ? ' active' : ''}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'users' && <UsersTab />}
      {tab === 'invite' && <InviteTab />}
      {tab === 'merge' && <MergeTab />}
      {tab === 'email' && <EmailTab />}
      {tab === 'sms' && <SmsTab />}
      {tab === 'events' && <EventsTab />}
    </div>
  )
}

/* ── USERS TAB ── */
function UsersTab() {
  const { users, user: me, reload } = useApp()
  const isSuperAdmin = me?.role === 'superadmin'
  const isAdmin = me?.role === 'admin' || me?.role === 'superadmin'
  const myRoles: string[] = (me as any)?.roles || (me?.role ? [me.role] : [])
  const canEditTrunkRep = isSuperAdmin || myRoles.includes('trunk_admin')
  const [editingName, setEditingName] = useState<string | null>(null)
  const [nameVal, setNameVal] = useState('')
  const [editingUser, setEditingUser] = useState<any>(null)
  const [editForm, setEditForm] = useState({ name: '', alternate_emails: [''] })
  const [buyerStates, setBuyerStates] = useState<Record<string, boolean>>({})
  const [orderedUsers, setOrderedUsers] = useState<typeof users>([])
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [mergeFor, setMergeFor] = useState<any>(null)
  const [mergeTargetId, setMergeTargetId] = useState<string>('')
  const [mergeBusy, setMergeBusy] = useState(false)
  const [mergeError, setMergeError] = useState<string | null>(null)
  const [allRoles, setAllRoles] = useState<Array<{ id: string; label: string }>>([])
  const [addingRoleFor, setAddingRoleFor] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.from('roles').select('id, label').order('id')
      if (!cancelled && data) setAllRoles(data as Array<{ id: string; label: string }>)
    })()
    return () => { cancelled = true }
  }, [])

  const addExtraRole = async (uid: string, roleId: string) => {
    setAddingRoleFor(null)
    const { error } = await supabase.from('user_roles').insert({ user_id: uid, role_id: roleId })
    if (error) {
      alert(`Failed to add role: ${error.message}`)
      return
    }
    reload()
  }

  const removeExtraRole = async (uid: string, roleId: string) => {
    if (!confirm(`Remove the "${roleId}" role from this user?`)) return
    const { error } = await supabase
      .from('user_roles')
      .delete()
      .eq('user_id', uid)
      .eq('role_id', roleId)
    if (error) {
      alert(`Failed to remove role: ${error.message}`)
      return
    }
    reload()
  }

  useEffect(() => {
    const sorted = [...users].sort((a, b) => ((a as any).sort_order || 0) - ((b as any).sort_order || 0))
    setOrderedUsers(sorted)
  }, [users])

  const getBuyer = (u: any) => buyerStates[u.id] !== undefined ? buyerStates[u.id] : u.is_buyer !== false

  const toggleBuyer = async (u: any) => {
    const next = !getBuyer(u)
    setBuyerStates(p => ({ ...p, [u.id]: next }))
    const { error } = await supabase.from('users').update({ is_buyer: next }).eq('id', u.id)
    if (error) {
      alert('Failed to update buyer status: ' + error.message)
      setBuyerStates(p => ({ ...p, [u.id]: !next }))
      return
    }
    reload()
  }

  // Mirror of the Buyer toggle for the new is_trunk_rep flag. Default
  // is FALSE (no special handling for `!== false` like is_buyer).
  const [trunkRepStates, setTrunkRepStates] = useState<Record<string, boolean>>({})
  const getTrunkRep = (u: any) => trunkRepStates[u.id] !== undefined ? trunkRepStates[u.id] : !!u.is_trunk_rep
  const toggleTrunkRep = async (u: any) => {
    const next = !getTrunkRep(u)
    setTrunkRepStates(p => ({ ...p, [u.id]: next }))
    const { error } = await supabase.from('users').update({ is_trunk_rep: next }).eq('id', u.id)
    if (error) {
      alert('Failed to update trunk rep status: ' + error.message)
      setTrunkRepStates(p => ({ ...p, [u.id]: !next }))
      return
    }
    reload()
  }

  const changeRole = async (uid: string, newRole: Role) => {
    if (!confirm(`Change primary role to ${newRole}?`)) return
    // Find the current primary so we can drop it from user_roles.
    // Without this the user accumulates a stale `roles` entry every
    // time they're promoted (since the sync trigger only inserts).
    const target = orderedUsers.find(u => u.id === uid)
    const oldRole = target?.role
    await supabase.from('users').update({ role: newRole }).eq('id', uid)
    if (oldRole && oldRole !== newRole) {
      await supabase.from('user_roles').delete()
        .eq('user_id', uid).eq('role_id', oldRole)
    }
    reload()
  }

  const toggleActive = async (uid: string, active: boolean) => {
    await supabase.from('users').update({ active: !active }).eq('id', uid)
    reload()
  }

  const saveName = async (uid: string) => {
    if (!nameVal.trim()) return
    await supabase.from('users').update({ name: nameVal.trim() }).eq('id', uid)
    void fetch('/api/notifications/reenqueue-for-buyer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buyer_id: uid, reason: 'name_edited' }),
    }).catch(() => {})
    setEditingName(null)
    reload()
  }

  const saveUserEdit = async () => {
    if (!editingUser) return
    const cleanEmails = editForm.alternate_emails.filter(e => e.trim())
    const { error } = await supabase.from('users').update({
      name: editForm.name,
      alternate_emails: cleanEmails
    }).eq('id', editingUser.id)
    if (error) { alert('Failed to save: ' + error.message); return }
    void fetch('/api/notifications/reenqueue-for-buyer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buyer_id: editingUser.id, reason: 'profile_edited' }),
    }).catch(() => {})
    setEditingUser(null)
    reload()
  }

  const submitMerge = async () => {
    if (!mergeFor || !mergeTargetId) return
    setMergeBusy(true)
    setMergeError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const res = await fetch('/api/admin/merge-pending', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ pendingUserId: mergeFor.id, targetUserId: mergeTargetId }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json?.error || `Merge failed (${res.status})`)
      }
      setMergeFor(null)
      setMergeTargetId('')
      reload()
    } catch (e: any) {
      setMergeError(e?.message || 'Merge failed')
    } finally {
      setMergeBusy(false)
    }
  }

  const deleteUser = async (uid: string, name: string) => {
    const input = window.prompt(`To permanently delete ${name}, type "delete" to confirm:`)
    if (input?.toLowerCase() !== 'delete') {
      if (input !== null) alert('Deletion cancelled — you must type "delete" exactly.')
      return
    }
    // Preserve worker name on events before deleting
    const { data: events } = await supabase.from('events').select('id, workers')
    if (events) {
      for (const ev of events) {
        const workers = ev.workers || []
        if (workers.some((w: any) => w.id === uid)) {
          // Keep the worker entry but mark as deleted so name still shows
          const updated = workers.map((w: any) =>
            w.id === uid ? { ...w, id: `deleted_${uid}`, deleted: true } : w
          )
          await supabase.from('events').update({ workers: updated }).eq('id', ev.id)
        }
      }
    }
    await supabase.from('users').delete().eq('id', uid)
    reload()
  }

  const handleDragStart = (id: string) => setDragId(id)
  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault()
    setDragOverId(id)
  }
  const handleDrop = async (targetId: string) => {
    if (!dragId || dragId === targetId) { setDragId(null); setDragOverId(null); return }
    const fromUser = orderedUsers.find(u => u.id === dragId)
    const toUser   = orderedUsers.find(u => u.id === targetId)
    // Drag is scoped to within a role group — moving a user
    // across roles via drag would silently flip their visual
    // group but keep their role unchanged, which is confusing.
    // Use the role-change action instead.
    if (!fromUser || !toUser || fromUser.role !== toUser.role) {
      setDragId(null); setDragOverId(null)
      return
    }
    const newOrder = [...orderedUsers]
    const fromIdx = newOrder.findIndex(u => u.id === dragId)
    const toIdx = newOrder.findIndex(u => u.id === targetId)
    const [moved] = newOrder.splice(fromIdx, 1)
    newOrder.splice(toIdx, 0, moved)
    setOrderedUsers(newOrder)
    setDragId(null)
    setDragOverId(null)
    // Save order to DB
    await Promise.all(newOrder.map((u, i) =>
      supabase.from('users').update({ sort_order: i }).eq('id', u.id)
    ))
  }

  // Display order for the per-role sections. Unknown / custom
  // roles fall through to a generic group at the bottom.
  const ROLE_ORDER: Array<{ role: Role; label: string }> = [
    { role: 'superadmin', label: 'Superadmins' },
    { role: 'admin',      label: 'Buyer Admins' },
    { role: 'marketing',  label: 'Marketing' },
    { role: 'accounting', label: 'Accounting' },
    { role: 'buyer',      label: 'Buyers' },
    { role: 'pending',    label: 'Pending' },
  ]
  const groupedUsers = (() => {
    const seen = new Set<string>()
    const groups: Array<{ role: string; label: string; users: typeof orderedUsers }> = []
    for (const { role, label } of ROLE_ORDER) {
      const list = orderedUsers.filter(u => u.role === role)
      seen.add(role)
      if (list.length > 0) groups.push({ role, label, users: list })
    }
    // Catch-all for any custom / unknown roles introduced via the
    // Role Manager so they don't disappear from the panel.
    const remaining = orderedUsers.filter(u => !seen.has(u.role))
    const byOther: Record<string, typeof orderedUsers> = {}
    for (const u of remaining) {
      ;(byOther[u.role] ||= []).push(u)
    }
    for (const role of Object.keys(byOther).sort()) {
      groups.push({
        role,
        label: role.charAt(0).toUpperCase() + role.slice(1).replace(/_/g, ' '),
        users: byOther[role],
      })
    }
    return groups
  })()

  const roleBadge = (role: Role) => {
    const map: Record<string,string> = { superadmin: 'badge-ruby', admin: 'badge-gold', buyer: 'badge-sapph', pending: 'badge-silver' }
    return <span className={`badge ${map[role] || 'badge-silver'}`}>{role.replace('_', ' ')}</span>
  }

  const initials = (name: string) => name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?'
  const avatarColors = ['#1D6B44','#2563EB','#7C3AED','#DC2626','#D97706','#0891B2']
  const avatarColor = (id: string) => avatarColors[id.charCodeAt(0) % avatarColors.length]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ fontSize: 12, color: 'var(--mist)' }}>
        ⠿ Drag cards to reorder within a role group. Use the role
        dropdown on a card to move a user to a different group.
      </div>
      {groupedUsers.map(g => (
      <div key={g.role} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{
          display: 'flex', alignItems: 'baseline', gap: 8,
          fontSize: 12, fontWeight: 800, color: 'var(--ash)',
          textTransform: 'uppercase', letterSpacing: '.06em',
          padding: '4px 2px', borderBottom: '1px solid var(--cream2)',
        }}>
          <span>{g.label}</span>
          <span style={{ fontWeight: 700, color: 'var(--mist)' }}>{g.users.length}</span>
        </div>
        {g.users.map(u => (
        <div key={u.id}
          draggable
          onDragStart={() => handleDragStart(u.id)}
          onDragOver={e => handleDragOver(e, u.id)}
          onDrop={() => handleDrop(u.id)}
          onDragEnd={() => { setDragId(null); setDragOverId(null) }}
          className="card"
          style={{
            padding: '16px 20px',
            cursor: 'grab',
            opacity: dragId === u.id ? 0.5 : 1,
            border: dragOverId === u.id && dragId !== u.id ? '2px solid var(--green)' : '1px solid var(--pearl)',
            transition: 'border .1s, opacity .1s',
          }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>

            {/* Drag handle */}
            <div style={{ color: 'var(--pearl)', fontSize: 18, cursor: 'grab', flexShrink: 0, lineHeight: 1 }}>⠿</div>

            {/* Avatar */}
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: avatarColor(u.id), display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 15, color: '#fff', flexShrink: 0 }}>
              {u.photo_url
                ? <img src={u.photo_url} alt={u.name || 'User'} style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover' }} />
                : initials(u.name || u.email)}
            </div>

            {/* Name + email */}
            <div style={{ flex: 1, minWidth: 160 }}>
              {editingName === u.id ? (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input value={nameVal} onChange={e => setNameVal(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && saveName(u.id)}
                    style={{ width: 160, padding: '5px 10px', fontSize: 13 }} autoFocus />
                  <button onClick={() => saveName(u.id)} className="btn-primary btn-xs">Save</button>
                  <button onClick={() => setEditingName(null)} className="btn-outline btn-xs">✕</button>
                </div>
              ) : (
                <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)' }}>{u.name || <span style={{ color: 'var(--mist)' }}>No name</span>}</div>
              )}
              <div style={{ fontSize: 13, color: 'var(--mist)', marginTop: 2 }}>{u.email}</div>
              {(u.alternate_emails || []).length > 0 && (
                <div style={{ fontSize: 11, color: 'var(--silver)', marginTop: 1 }}>+ {(u.alternate_emails || []).join(', ')}</div>
              )}
            </div>

            {/* Badges */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              {roleBadge(u.role)}
              <span className={`badge ${u.active ? 'badge-jade' : 'badge-silver'}`}>{u.active ? 'Active' : 'Inactive'}</span>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
              <button onClick={() => {
                setEditingUser(u)
                setEditForm({ name: u.name || '', alternate_emails: [...(u.alternate_emails || []), ''] })
              }} className="btn-outline btn-xs">✎ Edit</button>

              {u.id !== me?.id && (
                <select value={u.role} onChange={e => changeRole(u.id, e.target.value as Role)}
                  style={{ fontSize: 12, padding: '5px 28px 5px 10px', width: 'auto', fontWeight: 700 }}
                  title="Primary role">
                  {allRoles
                    .filter(r => r.id !== 'superadmin' || isSuperAdmin)
                    .map(r => (
                      <option key={r.id} value={r.id}>{r.label || r.id}</option>
                    ))
                  }
                </select>
              )}

              {/* Additional roles (multi-role) */}
              {(() => {
                const extras = (u.roles || []).filter(r => r !== u.role)
                const available = allRoles
                  .filter(r => r.id !== u.role && !extras.includes(r.id))
                  .filter(r => r.id !== 'superadmin' || isSuperAdmin)
                return (
                  <>
                    {extras.map(roleId => {
                      const def = allRoles.find(r => r.id === roleId)
                      return (
                        <span key={roleId} style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6,
                          background: '#EDE9FE', color: '#5B21B6',
                          padding: '3px 4px 3px 10px', borderRadius: 99,
                          fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
                        }}>
                          {def?.label || roleId}
                          {u.id !== me?.id && (
                            <button
                              onClick={() => removeExtraRole(u.id, roleId)}
                              style={{
                                border: 'none', background: 'rgba(91,33,182,.15)',
                                color: '#5B21B6', borderRadius: '50%',
                                width: 18, height: 18, padding: 0,
                                fontSize: 11, lineHeight: '16px', cursor: 'pointer',
                              }}
                              title={`Remove ${def?.label || roleId} role`}
                            >×</button>
                          )}
                        </span>
                      )
                    })}
                    {u.id !== me?.id && available.length > 0 && (
                      addingRoleFor === u.id ? (
                        <select
                          autoFocus
                          defaultValue=""
                          onChange={e => e.target.value && addExtraRole(u.id, e.target.value)}
                          onBlur={() => setAddingRoleFor(null)}
                          style={{ fontSize: 12, padding: '5px 28px 5px 10px', width: 'auto', fontWeight: 700 }}
                        >
                          <option value="">Pick role…</option>
                          {available.map(r => (
                            <option key={r.id} value={r.id}>+ {r.label || r.id}</option>
                          ))}
                        </select>
                      ) : (
                        <button
                          onClick={() => setAddingRoleFor(u.id)}
                          className="btn-outline btn-xs"
                          title="Grant an additional role"
                          style={{ borderStyle: 'dashed' }}
                        >+ role</button>
                      )
                    )}
                  </>
                )
              })()}

              <button onClick={() => toggleActive(u.id, u.active)} className="btn-outline btn-xs">
                {u.active ? 'Deactivate' : 'Activate'}
              </button>

              {u.role === 'pending' && (
                <button
                  onClick={() => { setMergeFor(u); setMergeTargetId(''); setMergeError(null) }}
                  className="btn-outline btn-xs"
                  style={{ borderColor: '#92400E', color: '#92400E' }}
                  title="If this user already exists under another email, merge their new login into the existing account."
                >
                  🔗 Merge
                </button>
              )}

              {isAdmin && (
                <label onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', userSelect: 'none' }}>
                  <div onClick={() => toggleBuyer(u)} style={{
                    width: 20, height: 20, borderRadius: 4, flexShrink: 0,
                    border: `2px solid ${getBuyer(u) ? 'var(--green)' : 'var(--pearl)'}`,
                    background: getBuyer(u) ? 'var(--green)' : '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', transition: 'all .15s',
                  }}>
                    {getBuyer(u) && (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: getBuyer(u) ? 'var(--green-dark)' : 'var(--ash)' }}>Buyer</span>
                </label>
              )}

              {canEditTrunkRep && (
                <label onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', userSelect: 'none' }}>
                  <div onClick={() => toggleTrunkRep(u)} style={{
                    width: 20, height: 20, borderRadius: 4, flexShrink: 0,
                    border: `2px solid ${getTrunkRep(u) ? 'var(--green)' : 'var(--pearl)'}`,
                    background: getTrunkRep(u) ? 'var(--green)' : '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', transition: 'all .15s',
                  }}>
                    {getTrunkRep(u) && (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: getTrunkRep(u) ? 'var(--green-dark)' : 'var(--ash)' }}>Trunk Rep</span>
                </label>
              )}
            </div>
          </div>
        </div>
        ))}
      </div>
      ))}

      {/* Merge Pending User Modal */}
      {mergeFor && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => mergeBusy ? null : setMergeFor(null)}
        >
          <div
            style={{ background: '#fff', borderRadius: 12, padding: 28, width: 480, maxWidth: '90vw' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 8 }}>Merge into existing user</div>
            <div style={{ fontSize: 13, color: 'var(--mist)', marginBottom: 18, lineHeight: 1.5 }}>
              Pick the existing user that <strong>{mergeFor.email}</strong> should be merged into.
              The pending row will be deleted and <strong>{mergeFor.email}</strong> will be added as
              an alternate email on the chosen user — they&apos;ll be able to sign in with either
              address going forward.
            </div>
            <div className="field">
              <label>Existing user</label>
              <select
                value={mergeTargetId}
                onChange={e => setMergeTargetId(e.target.value)}
                disabled={mergeBusy}
              >
                <option value="">Select a user…</option>
                {orderedUsers
                  .filter(u => u.role !== 'pending' && u.id !== mergeFor.id)
                  .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email))
                  .map(u => (
                    <option key={u.id} value={u.id}>
                      {u.name || '(no name)'} — {u.email} ({u.role})
                    </option>
                  ))
                }
              </select>
            </div>
            {mergeError && (
              <div style={{
                background: '#FEE2E2', color: '#991B1B',
                padding: '10px 14px', borderRadius: 8,
                fontSize: 13, marginTop: 10,
              }}>{mergeError}</div>
            )}
            <div style={{ display: 'flex', gap: 12, marginTop: 22 }}>
              <button
                onClick={submitMerge}
                disabled={!mergeTargetId || mergeBusy}
                className="btn-primary"
                style={{ opacity: (!mergeTargetId || mergeBusy) ? .6 : 1 }}
              >
                {mergeBusy ? 'Merging…' : 'Merge'}
              </button>
              <button
                onClick={() => setMergeFor(null)}
                disabled={mergeBusy}
                className="btn-outline"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setEditingUser(null)}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 32, width: 500, maxWidth: '90vw', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 20 }}>Edit User</div>
            <div className="field">
              <label>Name</label>
              <input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
            </div>
            <div className="field">
              <label>Primary Email (cannot be changed)</label>
              <input value={editingUser.email} disabled style={{ background: 'var(--cream)', color: 'var(--mist)' }} />
            </div>
            <div className="field">
              <label>Alternate Email Addresses</label>
              <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 8 }}>Users can sign in with any of these emails. Leave blank to remove.</div>
              {editForm.alternate_emails.map((email: string, i: number) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <input type="email" value={email} onChange={e => { const n = [...editForm.alternate_emails]; n[i] = e.target.value; setEditForm({ ...editForm, alternate_emails: n }) }} placeholder="user@example.com" style={{ flex: 1 }} />
                  {i > 0 && <button onClick={() => { const n = editForm.alternate_emails.filter((_: string, idx: number) => idx !== i); setEditForm({ ...editForm, alternate_emails: n }) }} className="btn-outline btn-xs">✕</button>}
                </div>
              ))}
              <button onClick={() => setEditForm({ ...editForm, alternate_emails: [...editForm.alternate_emails, ''] })} className="btn-outline btn-sm" style={{ marginTop: 8 }}>+ Add Another Email</button>
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 24, alignItems: 'center' }}>
              <button onClick={saveUserEdit} className="btn-primary">Save Changes</button>
              <button onClick={() => setEditingUser(null)} className="btn-outline">Cancel</button>
              {isSuperAdmin && editingUser.id !== me?.id && (
                <button
                  onClick={async () => {
                    await deleteUser(editingUser.id, editingUser.name)
                    setEditingUser(null)
                  }}
                  className="btn-danger"
                  style={{ marginLeft: 'auto' }}
                >Delete User</button>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

/* ── INVITE TAB ── */
function InviteTab() {
  const { user: me, reload } = useApp()
  const isSuperAdmin = me?.role === 'superadmin'
  const [form, setForm] = useState({ name: '', email: '', role: 'buyer' as Role })
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  const [doneMsg, setDoneMsg] = useState<string>('')

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name || !form.email) return
    setSaving(true)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token
      const res = await fetch('/api/admin/invite-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: form.name, email: form.email, role: form.role,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaving(false)
        alert(json.error || `Invite failed (${res.status})`)
        return
      }
      setDoneMsg(json.upgraded
        ? `${form.email} already had an account — role + access updated.`
        : `Sent invite email to ${form.email}. They'll get a Supabase "set your password" link to finish setup.`)
      setDone(true)
      reload()
    } catch (err: any) {
      alert(err?.message || 'Network error')
    }
    setSaving(false)
  }

  if (done) return (
    <div className="rounded-xl p-8 text-center" style={{ background: 'var(--card-bg)', border: '1px solid var(--pearl)' }}>
      <div className="text-4xl mb-3">✉️</div>
      <div className="font-bold text-lg mb-2" style={{ color: 'var(--ink)' }}>Invite sent</div>
      <p className="text-sm mb-6" style={{ color: 'var(--mist)' }}>{doneMsg}</p>
      <button onClick={() => { setDone(false); setDoneMsg(''); setForm({ name: '', email: '', role: 'buyer' }) }}
        className="btn-primary"
        >Invite Another</button>
    </div>
  )

  return (
    <div className="max-w-md">
      <div className="card">
        <h2 className="font-black text-lg mb-4" style={{ color: 'var(--ink)' }}>Invite New User</h2>
        <form onSubmit={handleInvite} className="space-y-4">
          {[['Name', 'name', 'text', 'Full name'], ['Email', 'email', 'email', 'user@bebllp.com']].map(([label, key, type, placeholder]) => (
            <div key={key}>
              <label className="fl">{label}</label>
              <input type={type} placeholder={placeholder} value={(form as any)[key]}
                onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} required
                className="w-full px-3 py-2.5 rounded-lg text-sm"
                style={{ background: 'var(--cream2)', border: '1px solid var(--pearl)', color: 'var(--ink)' }} />
            </div>
          ))}
          <div>
            <label className="fl">Role</label>
            <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value as Role }))}
              className="w-full px-3 py-2.5 rounded-lg text-sm"
              style={{ background: 'var(--cream2)', border: '1px solid var(--pearl)', color: 'var(--ink)' }}>
              <option value="buyer">Buyer</option>
              <option value="admin">Buyer Admin</option>
              {isSuperAdmin && <option value="superadmin">Superadmin</option>}
              <option value="marketing">Marketing</option>
              <option value="accounting">Accounting</option>
            </select>
          </div>
          <button type="submit" disabled={saving}
            className="btn-primary btn-full">
            {saving ? 'Adding…' : 'Add User'}
          </button>
        </form>
      </div>
    </div>
  )
}

/* ── MERGE TAB ── */
function MergeTab() {
  const { users, reload } = useApp()
  const [primary, setPrimary] = useState('')
  const [duplicate, setDuplicate] = useState('')
  const [merging, setMerging] = useState(false)

  const handleMerge = async () => {
    if (!primary || !duplicate || primary === duplicate) return
    const primaryUser = users.find(u => u.id === primary)
    const dupUser = users.find(u => u.id === duplicate)
    if (!primaryUser || !dupUser) return
    if (!confirm(`Merge ${dupUser.name} into ${primaryUser.name}?\n\nThe duplicate account will be deactivated and their email added as an alternate.`)) return
    setMerging(true)
    const newAlts = [...(primaryUser.alternate_emails || []), dupUser.email]
    await supabase.from('users').update({ alternate_emails: newAlts }).eq('id', primary)
    await supabase.from('users').update({ active: false }).eq('id', duplicate)
    setMerging(false)
    setPrimary('')
    setDuplicate('')
    reload()
  }

  const sel = (val: string, onChange: (v: string) => void, exclude: string) => (
    <select value={val} onChange={e => onChange(e.target.value)}
      style={{ width: '100%' }}>
      <option value="">Select user…</option>
      {users.filter(u => u.id !== exclude).map(u => (
        <option key={u.id} value={u.id}>{u.name} — {u.email}</option>
      ))}
    </select>
  )

  return (
    <div className="max-w-md">
      <div className="card">
        <div className="card-title">Merge Users</div>
        <p style={{ fontSize: 13, color: 'var(--mist)', marginBottom: 20 }}>Combine two accounts that belong to the same person.</p>
        <div className="space-y-4">
          <div><label className="fl">Keep (Primary)</label>{sel(primary, setPrimary, duplicate)}</div>
          <div><label className="fl">Remove (Duplicate)</label>{sel(duplicate, setDuplicate, primary)}</div>
          <button onClick={handleMerge} disabled={!primary || !duplicate || merging}
            className="btn-primary btn-full">
            {merging ? 'Merging…' : 'Merge Accounts'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── EMAIL TAB ── */
function EmailTab() {
  const { user } = useApp()
  const [cfg, setCfg] = useState<any>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testTo, setTestTo] = useState('')
  const [sendingTest, setSendingTest] = useState(false)

  useEffect(() => {
    supabase.from('settings').select('value').eq('key', 'email').maybeSingle()
      .then(({ data }) => { setCfg(data?.value || {}); setLoading(false) })
  }, [])

  // Default the test recipient to the logged-in user's email once loaded.
  useEffect(() => { if (!testTo && user?.email) setTestTo(user.email) }, [user?.email])

  const save = async () => {
    setSaving(true)
    await supabase.from('settings').upsert({ key: 'email', value: cfg, updated_at: new Date().toISOString() })
    setSaving(false)
    alert('Email settings saved!')
  }

  if (loading) return <div className="text-sm" style={{ color: 'var(--mist)' }}>Loading…</div>

  return (
    <div className="max-w-lg" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <h2 className="font-black text-lg mb-4" style={{ color: 'var(--ink)' }}>Email Settings</h2>
        <div className="space-y-4">
          {[
            ['Provider', 'provider', 'select'],
            ['API Key', 'apiKey', 'password'],
            ['From Email', 'fromEmail', 'email'],
            ['From Name', 'fromName', 'text'],
          ].map(([label, key, type]) => (
            <div key={key}>
              <label className="fl">{label}</label>
              {type === 'select' ? (
                <select value={cfg[key] || 'resend'} onChange={e => setCfg((p: any) => ({ ...p, [key]: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-lg text-sm"
                  style={{ background: 'var(--cream2)', border: '1px solid var(--pearl)', color: 'var(--ink)' }}>
                  <option value="resend">Resend</option>
                  <option value="sendgrid">SendGrid</option>
                  <option value="smtp">SMTP / Gmail</option>
                </select>
              ) : (
                <input type={type} value={cfg[key] || ''} onChange={e => setCfg((p: any) => ({ ...p, [key]: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-lg text-sm"
                  style={{ background: 'var(--cream2)', border: '1px solid var(--pearl)', color: 'var(--ink)' }} />
              )}
            </div>
          ))}
          <button onClick={save} disabled={saving}
            className="btn-primary btn-full"
            >{saving ? 'Saving…' : 'Save Settings'}</button>

          <div style={{ borderTop: '1px solid var(--cream2)', paddingTop: 16, marginTop: 4 }}>
            <label className="fl">Test Recipient</label>
            <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 6 }}>
              Who to send the test email to. Defaults to your own account email.
            </div>
            <input type="email" value={testTo} onChange={e => setTestTo(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-3 py-2.5 rounded-lg text-sm"
              style={{ background: 'var(--cream2)', border: '1px solid var(--pearl)', color: 'var(--ink)', marginBottom: 10 }} />
            <button
              onClick={async () => {
                if (!testTo) { alert('Enter a test recipient email first.'); return }
                setSendingTest(true)
                try {
                  const r = await fetch('/api/test-email', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ to: testTo }),
                  })
                  const d = await r.json()
                  alert(d.ok ? `✅ Test email sent to ${testTo}` : `❌ ${d.error || 'Failed to send'}`)
                } finally {
                  setSendingTest(false)
                }
              }}
              disabled={sendingTest || !testTo}
              className="w-full py-2.5 rounded-lg text-sm font-bold border"
              >{sendingTest ? 'Sending…' : 'Send Test Email'}</button>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="font-black text-lg mb-2" style={{ color: 'var(--ink)' }}>Morning Briefing Keys</h2>
        <p style={{ fontSize: 13, color: 'var(--mist)', marginBottom: 18 }}>
          API keys powering the Morning Briefing email. Pick recipients and send from <strong>Reports → Morning Briefing</strong>.
        </p>

        <div className="space-y-4">
          <div>
            <label className="fl">OpenWeatherMap API Key</label>
            <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 6 }}>
              Free tier (1,000 calls/day). Sign up at openweathermap.org/api.
            </div>
            <input type="password" value={cfg.weatherApiKey || ''}
              onChange={e => setCfg((p: any) => ({ ...p, weatherApiKey: e.target.value }))}
              placeholder="••••••••"
              className="w-full px-3 py-2.5 rounded-lg text-sm"
              style={{ background: 'var(--cream2)', border: '1px solid var(--pearl)', color: 'var(--ink)' }} />
          </div>

          <div>
            <label className="fl">Anthropic API Key</label>
            <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 6 }}>
              Powers the AI shoutout. Create at console.anthropic.com.
            </div>
            <input type="password" value={cfg.anthropicApiKey || ''}
              onChange={e => setCfg((p: any) => ({ ...p, anthropicApiKey: e.target.value }))}
              placeholder="sk-ant-…"
              className="w-full px-3 py-2.5 rounded-lg text-sm"
              style={{ background: 'var(--cream2)', border: '1px solid var(--pearl)', color: 'var(--ink)' }} />
          </div>

          <button onClick={save} disabled={saving}
            className="w-full py-2.5 rounded-lg text-sm font-bold border"
            >{saving ? 'Saving…' : 'Save Keys'}</button>
        </div>
      </div>
    </div>
  )
}

/* ── SMS TAB ── */
function SmsTab() {
  const { user } = useApp()
  const [cfg, setCfg] = useState<any>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testTo, setTestTo] = useState('')
  const [sendingTest, setSendingTest] = useState(false)

  useEffect(() => {
    supabase.from('settings').select('value').eq('key', 'sms').maybeSingle()
      .then(({ data }) => { setCfg(data?.value || {}); setLoading(false) })
  }, [])

  useEffect(() => { if (!testTo && user?.phone) setTestTo(user.phone) }, [user?.phone])

  const save = async () => {
    setSaving(true)
    await supabase.from('settings').upsert({
      key: 'sms',
      value: cfg,
      updated_at: new Date().toISOString(),
      updated_by: user?.id,
    })
    setSaving(false)
    alert('SMS settings saved!')
  }

  if (loading) return <div className="text-sm" style={{ color: 'var(--mist)' }}>Loading…</div>

  return (
    <div className="max-w-lg">
      <div className="card">
        <h2 className="font-black text-lg mb-4" style={{ color: 'var(--ink)' }}>SMS Settings</h2>
        <p style={{ fontSize: 13, color: 'var(--mist)', marginBottom: 18 }}>
          Twilio credentials for SMS alerts. Create them at console.twilio.com → Account → API keys & tokens.
        </p>
        <div className="space-y-4">
          {[
            ['Account SID', 'accountSid', 'text', 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'],
            ['Auth Token', 'authToken', 'password', '••••••••'],
            ['From Number', 'fromNumber', 'tel', '+1234567890'],
          ].map(([label, key, type, placeholder]) => (
            <div key={key}>
              <label className="fl">{label}</label>
              <input type={type} value={cfg[key] || ''} onChange={e => setCfg((p: any) => ({ ...p, [key]: e.target.value }))}
                placeholder={placeholder}
                className="w-full px-3 py-2.5 rounded-lg text-sm"
                style={{ background: 'var(--cream2)', border: '1px solid var(--pearl)', color: 'var(--ink)' }} />
            </div>
          ))}
          <button onClick={save} disabled={saving} className="btn-primary btn-full">
            {saving ? 'Saving…' : 'Save Settings'}
          </button>

          <div style={{ borderTop: '1px solid var(--cream2)', paddingTop: 16, marginTop: 4 }}>
            <label className="fl">Test Recipient</label>
            <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 6 }}>
              Phone to send the test SMS to. Defaults to your profile number.
            </div>
            <input type="tel" value={testTo} onChange={e => setTestTo(e.target.value)}
              placeholder="+1234567890"
              className="w-full px-3 py-2.5 rounded-lg text-sm"
              style={{ background: 'var(--cream2)', border: '1px solid var(--pearl)', color: 'var(--ink)', marginBottom: 10 }} />
            <button
              onClick={async () => {
                if (!testTo) { alert('Enter a test recipient number first.'); return }
                setSendingTest(true)
                try {
                  const r = await fetch('/api/test-sms', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ to: testTo }),
                  })
                  const d = await r.json()
                  alert(d.ok ? `✅ Test SMS sent to ${testTo}` : `❌ ${d.error || 'Failed to send'}`)
                } finally {
                  setSendingTest(false)
                }
              }}
              disabled={sendingTest || !testTo}
              className="w-full py-2.5 rounded-lg text-sm font-bold border">
              {sendingTest ? 'Sending…' : 'Send Test SMS'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── EVENTS TAB ── superadmin tools to edit/delete an event */
function EventsTab() {
  return (
    <div>
      <EditEventSection />
      <DeleteEventSection />
    </div>
  )
}

function EditEventSection() {
  const { user: me, events, stores, reload } = useApp()
  const isSuperAdmin = me?.role === 'superadmin'
  const [selectedId, setSelectedId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [storeId, setStoreId] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')

  const sortedEvents = [...events].sort((a, b) => b.start_date.localeCompare(a.start_date))
  const selected = sortedEvents.find(e => e.id === selectedId)
  const sortedStores = [...stores].sort((a, b) => (a.name || '').localeCompare(b.name || ''))

  // Sync the inputs whenever the selected event changes.
  useEffect(() => {
    if (selected) {
      setStartDate(selected.start_date || '')
      setStoreId(selected.store_id || '')
    } else {
      setStartDate(''); setStoreId('')
    }
  }, [selectedId])

  const fmtRange = (ds: string) => {
    if (!ds) return ''
    const s = new Date(ds + 'T12:00:00')
    const e = new Date(ds + 'T12:00:00'); e.setDate(e.getDate() + 2)
    const sm = s.toLocaleDateString('en-US', { month: 'short' })
    const em = e.toLocaleDateString('en-US', { month: 'short' })
    const year = s.getFullYear()
    return sm !== em
      ? `${sm} ${s.getDate()} – ${em} ${e.getDate()}, ${year}`
      : `${sm} ${s.getDate()}–${e.getDate()}, ${year}`
  }

  const dirty = !!selected && (startDate !== selected.start_date || storeId !== selected.store_id)
  const canSave = isSuperAdmin && !!selected && dirty && !!startDate && !!storeId && !saving

  const handleSave = async () => {
    if (!canSave || !selected) return
    setSaving(true)
    try {
      const store = sortedStores.find(s => s.id === storeId)
      const { error } = await supabase.from('events').update({
        start_date: startDate,
        store_id: storeId,
        store_name: store?.name || selected.store_name,
      }).eq('id', selected.id)
      if (error) throw error
      setToast(`Event updated — ${store?.name || selected.store_name} ${fmtRange(startDate)}`)
      await reload()
      setTimeout(() => setToast(''), 4000)
    } catch (err: any) {
      alert('Save failed: ' + (err?.message || 'unknown'))
    } finally {
      setSaving(false)
    }
  }

  if (!isSuperAdmin) return null

  return (
    <div className="card mt-6" style={{ padding: 0, overflow: 'hidden', borderTop: '3px solid var(--green)' }}>
      <div className="px-6 py-4" style={{ borderBottom: '1px solid var(--pearl)' }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>✎ Edit Event</div>
        <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 2 }}>
          Move an event to a different date or reassign it to another store. Workers, day data, and ad spend are preserved.
        </div>
      </div>

      <div className="px-6 py-5" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label className="fl">Event</label>
          <select value={selectedId} onChange={e => setSelectedId(e.target.value)} style={{ width: '100%', maxWidth: 480 }}>
            <option value="">— pick an event —</option>
            {sortedEvents.map(ev => (
              <option key={ev.id} value={ev.id}>
                {ev.store_name} · {fmtRange(ev.start_date)}
              </option>
            ))}
          </select>
        </div>

        {selected && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, maxWidth: 600 }}>
              <div>
                <label className="fl">Start date (Day 1)</label>
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 4 }}>
                  Event runs 3 days. New range: <strong>{fmtRange(startDate)}</strong>
                </div>
              </div>
              <div>
                <label className="fl">Store</label>
                <select value={storeId} onChange={e => setStoreId(e.target.value)} style={{ width: '100%' }}>
                  {sortedStores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button onClick={handleSave} disabled={!canSave} className="btn-primary btn-sm">
                {saving ? 'Saving…' : 'Save changes'}
              </button>
              {!dirty && <span style={{ fontSize: 12, color: 'var(--mist)' }}>No changes yet.</span>}
              {toast && <span style={{ fontSize: 12, color: 'var(--green-dark)', fontWeight: 700 }}>✓ {toast}</span>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function DeleteEventSection() {
  const { user: me, events, reload } = useApp()
  const isSuperAdmin = me?.role === 'superadmin'
  const [selectedId, setSelectedId] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [toast, setToast] = useState('')

  const sortedEvents = [...events].sort((a, b) => b.start_date.localeCompare(a.start_date))
  const selected = sortedEvents.find(e => e.id === selectedId)

  const fmtDate = (ds: string) =>
    new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const fmtRange = (ds: string) => {
    const s = new Date(ds + 'T12:00:00')
    const e = new Date(ds + 'T12:00:00'); e.setDate(e.getDate() + 2)
    const sm = s.toLocaleDateString('en-US', { month: 'short' })
    const em = e.toLocaleDateString('en-US', { month: 'short' })
    const year = s.getFullYear()
    return sm !== em
      ? `${sm} ${s.getDate()} – ${em} ${e.getDate()}, ${year}`
      : `${sm} ${s.getDate()}–${e.getDate()}, ${year}`
  }

  const requiredConfirm = selected ? `delete-${selected.start_date}` : ''
  const canDelete = isSuperAdmin && !!selected && confirmText === requiredConfirm && !deleting

  const handleDelete = async () => {
    if (!canDelete || !selected) return
    setDeleting(true)
    try {
      // Manual ordered cascade in case FKs aren't set to ON DELETE CASCADE.
      await supabase.from('buyer_checks').delete().eq('event_id', selected.id)
      await supabase.from('buyer_entries').delete().eq('event_id', selected.id)
      await supabase.from('event_days').delete().eq('event_id', selected.id)
      const { error } = await supabase.from('events').delete().eq('id', selected.id)
      if (error) throw error
      setToast(`Event deleted — ${selected.store_name} ${fmtDate(selected.start_date)}`)
      setSelectedId('')
      setConfirmText('')
      await reload()
      setTimeout(() => setToast(''), 4000)
    } catch (err: any) {
      alert('Delete failed: ' + (err?.message || 'unknown'))
    } finally {
      setDeleting(false)
    }
  }

  const workerCount = selected?.workers?.length || 0
  const daysWithData = (selected?.days || []).filter((d: any) =>
    (d.customers ?? 0) + (d.purchases ?? 0) + (d.dollars10 ?? 0) + (d.dollars5 ?? 0) > 0
  ).length
  const totalSpend = selected
    ? ((selected.spend_vdp || 0) + (selected.spend_newspaper || 0) + (selected.spend_postcard || 0) + (selected.spend_spiffs || 0))
    : 0

  return (
    <div className="card mt-6" style={{ padding: 0, overflow: 'hidden', borderTop: '3px solid var(--red)' }}>
      <div className="px-6 py-4" style={{ borderBottom: '1px solid var(--pearl)' }}>
        <div className="font-black text-lg flex items-center gap-2" style={{ color: 'var(--ink)' }}>
          <span aria-hidden>⚠️</span> Delete Event
        </div>
        <div className="text-xs mt-0.5" style={{ color: 'var(--mist)' }}>
          Permanently remove an event and all associated data.
          {!isSuperAdmin && <span style={{ color: 'var(--red)', marginLeft: 8, fontWeight: 700 }}>Superadmin access required to delete events.</span>}
        </div>
      </div>

      <div className="px-6 py-5" style={{ opacity: isSuperAdmin ? 1 : 0.55, pointerEvents: isSuperAdmin ? 'auto' : 'none' }}>
        <label className="fl">Select event to delete</label>
        <select value={selectedId} onChange={e => { setSelectedId(e.target.value); setConfirmText('') }} disabled={!isSuperAdmin}>
          <option value="">Choose an event…</option>
          {sortedEvents.map(ev => (
            <option key={ev.id} value={ev.id}>{ev.store_name} — {fmtDate(ev.start_date)}</option>
          ))}
        </select>

        {selected && (
          <div className="mt-4 p-4 rounded-lg" style={{ background: 'var(--cream2)', border: '1px solid var(--pearl)' }}>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="fl" style={{ marginBottom: 2 }}>Store</span><div style={{ fontWeight: 700, color: 'var(--ink)' }}>{selected.store_name}</div></div>
              <div><span className="fl" style={{ marginBottom: 2 }}>Dates</span><div style={{ fontWeight: 700, color: 'var(--ink)' }}>{fmtRange(selected.start_date)}</div></div>
              <div><span className="fl" style={{ marginBottom: 2 }}>Workers assigned</span><div style={{ fontWeight: 700, color: 'var(--ink)' }}>{workerCount}</div></div>
              <div><span className="fl" style={{ marginBottom: 2 }}>Days with data</span><div style={{ fontWeight: 700, color: 'var(--ink)' }}>{daysWithData} of 3</div></div>
              <div style={{ gridColumn: '1 / -1' }}><span className="fl" style={{ marginBottom: 2 }}>Total ad spend</span><div style={{ fontWeight: 700, color: 'var(--ink)' }}>${totalSpend.toLocaleString()}</div></div>
            </div>

            <div className="mt-4 p-3 rounded-md" style={{ background: 'var(--red-pale)', border: '1px solid var(--red)', color: 'var(--red)', fontSize: 13, fontWeight: 600 }}>
              ⚠ This will permanently delete the event, all day data, all check data, and all associated records. This cannot be undone.
            </div>

            <div className="mt-4">
              <label className="fl">Type <code style={{ background: 'var(--cream)', padding: '1px 6px', borderRadius: 4, fontSize: 12 }}>{requiredConfirm}</code> to confirm</label>
              <input
                type="text"
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                placeholder={requiredConfirm}
                autoCapitalize="off"
                spellCheck={false}
              />
            </div>

            <button
              onClick={handleDelete}
              disabled={!canDelete}
              className="btn-full mt-4"
              style={{
                background: canDelete ? 'var(--red)' : 'var(--pearl)',
                color: canDelete ? '#fff' : 'var(--mist)',
                padding: '12px 22px',
                cursor: canDelete ? 'pointer' : 'not-allowed',
                fontWeight: 900,
              }}>
              {deleting ? 'Deleting…' : 'Permanently Delete Event'}
            </button>
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-lg shadow-lg z-50"
          style={{ background: 'var(--green)', color: '#fff', fontWeight: 700, fontSize: 14 }}>
          ✓ {toast}
        </div>
      )}
    </div>
  )
}
