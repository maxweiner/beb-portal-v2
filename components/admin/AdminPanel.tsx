'use client'

import { useState, useEffect } from 'react'
import { useApp, DEFAULT_PERMS } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type { User, Role } from '@/types'

type Tab = 'users' | 'invite' | 'merge' | 'email' | 'permissions'

export default function AdminPanel() {
  const [tab, setTab] = useState<Tab>('users')
  const { user } = useApp()
  const isSuperAdmin = user?.role === 'superadmin'

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
          ['permissions', 'Permissions'],
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
      {tab === 'permissions' && <PermissionsTab />}
    </div>
  )
}

/* ── USERS TAB ── */
function UsersTab() {
  const { users, user: me, reload } = useApp()
  const isSuperAdmin = me?.role === 'superadmin'
  const [editingName, setEditingName] = useState<string | null>(null)
  const [nameVal, setNameVal] = useState('')

  const changeRole = async (uid: string, newRole: Role) => {
    if (!confirm(`Change role to ${newRole}?`)) return
    await supabase.from('users').update({ role: newRole }).eq('id', uid)
    reload()
  }

  const toggleActive = async (uid: string, active: boolean) => {
    await supabase.from('users').update({ active: !active }).eq('id', uid)
    reload()
  }

  const saveName = async (uid: string) => {
    if (!nameVal.trim()) return
    await supabase.from('users').update({ name: nameVal.trim() }).eq('id', uid)
    setEditingName(null)
    reload()
  }

  const deleteUser = async (uid: string, name: string) => {
    if (!confirm(`Permanently delete ${name}?\n\nThis cannot be undone.`)) return
    await supabase.from('users').delete().eq('id', uid)
    reload()
  }

  const roleBadge = (role: Role) => {
    const map: Record<string,string> = { superadmin: 'badge-ruby', admin: 'badge-gold', buyer: 'badge-sapph', pending: 'badge-silver', non_buyer_admin: 'badge-silver' }
    return <span className={`badge ${map[role] || 'badge-silver'}`}>{role.replace('_', ' ')}</span>
  }

  const initials = (name: string) => name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?'
  const avatarColors = ['#1D6B44','#2563EB','#7C3AED','#DC2626','#D97706','#0891B2']
  const avatarColor = (id: string) => avatarColors[id.charCodeAt(0) % avatarColors.length]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {users.map(u => (
        <div key={u.id} className="card" style={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>

            {/* Avatar */}
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: avatarColor(u.id), display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 15, color: '#fff', flexShrink: 0 }}>
              {u.photo_url
                ? <img src={u.photo_url} style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover' }} />
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

            {/* Phone */}
            <div style={{ fontSize: 13, color: 'var(--mist)', minWidth: 110, display: 'none' }}>{u.phone || '—'}</div>

            {/* Badges */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              {roleBadge(u.role)}
              <span className={`badge ${u.active ? 'badge-jade' : 'badge-silver'}`}>{u.active ? 'Active' : 'Inactive'}</span>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
              <button onClick={() => { setEditingName(u.id); setNameVal(u.name || '') }}
                className="btn-outline btn-xs">✎ Name</button>

              {u.id !== me?.id && (
                <select value={u.role} onChange={e => changeRole(u.id, e.target.value as Role)}
                  style={{ fontSize: 12, padding: '5px 28px 5px 10px', width: 'auto', fontWeight: 700 }}>
                  <option value="pending">Pending</option>
                  <option value="buyer">Buyer</option>
                  <option value="admin">Admin</option>
                  <option value="non_buyer_admin">Non-Buyer Admin</option>
                  {isSuperAdmin && <option value="superadmin">Superadmin</option>}
                </select>
              )}

              <button onClick={() => toggleActive(u.id, u.active)} className="btn-outline btn-xs">
                {u.active ? 'Deactivate' : 'Activate'}
              </button>

              {isSuperAdmin && u.id !== me?.id && (
                <button onClick={() => deleteUser(u.id, u.name)} className="btn-danger btn-xs">🗑</button>
              )}
            </div>
          </div>
        </div>
      ))}
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

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name || !form.email) return
    setSaving(true)
    const { error } = await supabase.from('users').insert({
      name: form.name, email: form.email.toLowerCase(), role: form.role, active: true, notify: false, phone: ''
    })
    setSaving(false)
    if (error) { alert(error.message); return }
    setDone(true)
    reload()
  }

  if (done) return (
    <div className="rounded-xl p-8 text-center" style={{ background: 'var(--card-bg)', border: '1px solid var(--pearl)' }}>
      <div className="text-4xl mb-3">✅</div>
      <div className="font-bold text-lg mb-2" style={{ color: 'var(--ink)' }}>User added!</div>
      <p className="text-sm mb-6" style={{ color: 'var(--mist)' }}>They can now sign in with {form.email}</p>
      <button onClick={() => { setDone(false); setForm({ name: '', email: '', role: 'buyer' }) }}
        className="btn-primary"
        >Add Another</button>
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
              <option value="admin">Admin</option>
              <option value="non_buyer_admin">Non-Buyer Admin</option>
              {isSuperAdmin && <option value="superadmin">Superadmin</option>}
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
  const [cfg, setCfg] = useState<any>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.from('settings').select('value').eq('key', 'email').maybeSingle()
      .then(({ data }) => { setCfg(data?.value || {}); setLoading(false) })
  }, [])

  const save = async () => {
    setSaving(true)
    await supabase.from('settings').upsert({ key: 'email', value: cfg, updated_at: new Date().toISOString() })
    setSaving(false)
    alert('Email settings saved!')
  }

  if (loading) return <div className="text-sm" style={{ color: 'var(--mist)' }}>Loading…</div>

  return (
    <div className="max-w-lg">
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
          <button onClick={async () => {
            const r = await fetch('/api/test-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: cfg.fromEmail }) })
            const d = await r.json()
            alert(d.ok ? '✅ Test email sent!' : `❌ ${d.error}`)
          }}
            className="w-full py-2.5 rounded-lg text-sm font-bold border"
            >Send Test Email</button>
        </div>
      </div>
    </div>
  )
}

/* ── PERMISSIONS TAB ── */
const FEATURES = [
  { key: 'dashboard',  label: 'Dashboard' },
  { key: 'calendar',   label: 'Calendar' },
  { key: 'events',     label: 'Events' },
  { key: 'dayentry',   label: 'Enter Day Data' },
  { key: 'shipping',   label: 'Shipping Log' },
  { key: 'reports',    label: 'Reports' },
  { key: 'stores',     label: 'Stores' },
  { key: 'historical', label: 'Historical Data' },
  { key: 'admin',      label: 'Admin Panel' },
]

function PermissionsTab() {
  const { user: me, permissions, reload } = useApp()
  const isSuperAdmin = me?.role === 'superadmin'
  // Local copy so checkboxes work independently of global state
  const [localPerms, setLocalPerms] = useState<Record<string, Record<string, boolean>>>(
    permissions || DEFAULT_PERMS
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Sync if global permissions load after mount
  useEffect(() => {
    if (permissions) setLocalPerms(permissions)
  }, [permissions])

  const toggle = (feature: string, role: string) => {
    setLocalPerms(prev => ({
      ...prev,
      [feature]: { ...(prev[feature] || {}), [role]: !(prev[feature] || {})[role] }
    }))
  }

  const save = async () => {
    setSaving(true)
    const { error } = await supabase.from('settings').upsert({
      key: 'permissions',
      value: localPerms,
      updated_at: new Date().toISOString(),
      updated_by: me?.id,
    })
    setSaving(false)
    if (error) { alert(error.message); return }
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
    reload()
  }

  const ROLES = ['buyer', 'admin', 'superadmin']

  return (
    <div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--pearl)' }}>
          <div>
            <div className="font-black text-lg" style={{ color: 'var(--ink)' }}>Permission Matrix</div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--mist)' }}>
              {isSuperAdmin ? 'Toggle permissions then save. Superadmin always has full access.' : 'Superadmin access required to edit.'}
            </div>
          </div>
          {isSuperAdmin && (
            <button onClick={save} disabled={saving}
              className="btn-primary"
              style={{ background: saved ? '#22c55e' : 'var(--green)' }}>
              {saving ? 'Saving…' : saved ? '✓ Saved!' : 'Save Changes'}
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--pearl)', background: 'var(--cream2)' }}>
                <th className="text-left px-6 py-3 text-xs font-bold uppercase tracking-wide w-2/5" style={{ color: 'var(--mist)' }}>Feature</th>
                {ROLES.map(r => (
                  <th key={r} className="text-center px-6 py-3">
                    <span className={`badge badge-${r === 'superadmin' ? 'ruby' : r === 'admin' ? 'gold' : 'sapph'}`}>{r}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURES.map((f, i) => (
                <tr key={f.key} style={{ borderBottom: i < FEATURES.length - 1 ? '1px solid var(--cream2)' : 'none' }}>
                  <td className="px-6 py-4 font-semibold" style={{ color: 'var(--ink)' }}>{f.label}</td>
                  {ROLES.map(r => {
                    const isLocked = r === 'superadmin'
                    const checked = isLocked || localPerms[f.key]?.[r] !== false
                    return (
                      <td key={r} className="px-6 py-4 text-center">
                        {isLocked ? (
                          <span className="text-xl" style={{ color: 'var(--green)' }}>✓</span>
                        ) : isSuperAdmin ? (
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(f.key, r)}
                            className="w-5 h-5 cursor-pointer rounded"
                            style={{ accentColor: 'var(--green)' }}
                          />
                        ) : (
                          <span className="text-xl" style={{ color: checked ? 'var(--green)' : 'var(--fog)' }}>
                            {checked ? '✓' : '✗'}
                          </span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {!isSuperAdmin && (
        <div className="mt-3 p-3 rounded-lg text-sm notice notice-gold">
          ⚠ Only superadmins can edit permissions.
        </div>
      )}
    </div>
  )
}
