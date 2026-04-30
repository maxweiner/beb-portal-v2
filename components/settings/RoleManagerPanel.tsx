'use client'

// Role Manager — gated to max@bebll.com via the can_manage_roles()
// SQL helper. Lists every row in `roles`, lets the operator toggle
// any module on/off per role, and create or delete non-system roles.
// All writes are direct supabase-js calls — RLS is the gate.
//
// This is the GUI side of PR B. PRs C/D switch the sidebar + page
// guards to consult role_modules instead of hardcoded checks.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

type ModuleId =
  | 'dashboard' | 'calendar' | 'events' | 'schedule' | 'travel'
  | 'dayentry' | 'staff' | 'admin' | 'libertyadmin' | 'stores'
  | 'data-research' | 'reports' | 'financials' | 'marketing'
  | 'shipping' | 'expenses' | 'todo' | 'recipients'
  | 'notification-templates'

interface Role {
  id: string
  label: string
  description: string | null
  is_system: boolean
}

interface ModuleSection {
  label: string
  modules: { id: ModuleId; label: string }[]
}

// Mirrors the BEB / LIBERTY nav lists' grouping + labels.
const MODULE_SECTIONS: ModuleSection[] = [
  {
    label: 'Daily',
    modules: [
      { id: 'dashboard', label: 'Dashboard' },
      { id: 'calendar',  label: 'Appointments' },
      { id: 'events',    label: 'Events' },
      { id: 'schedule',  label: 'Calendar' },
      { id: 'travel',    label: 'Travel Share' },
      { id: 'dayentry',  label: 'Enter Day Data' },
      { id: 'staff',     label: 'Staff' },
    ],
  },
  {
    label: 'Admin',
    modules: [
      { id: 'admin',                  label: 'Admin Panel' },
      { id: 'libertyadmin',           label: 'Liberty Admin' },
      { id: 'stores',                 label: 'Stores' },
      { id: 'data-research',          label: 'Data Research' },
      { id: 'reports',                label: 'Reports & Notify' },
      { id: 'financials',             label: 'Financials (Partner)' },
      { id: 'recipients',             label: 'Recipients' },
      { id: 'notification-templates', label: 'Notification Templates' },
    ],
  },
  {
    label: 'Tools',
    modules: [
      { id: 'marketing', label: 'Marketing' },
      { id: 'shipping',  label: 'Shipping' },
      { id: 'expenses',  label: 'Expenses' },
      { id: 'todo',      label: 'To-Do List' },
    ],
  },
]

export default function RoleManagerPanel() {
  const [roles, setRoles] = useState<Role[]>([])
  // Map<roleId, Set<moduleId>>
  const [grants, setGrants] = useState<Map<string, Set<ModuleId>>>(new Map())
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  async function load() {
    setLoading(true); setErr(null)
    try {
      const [{ data: rs, error: rErr }, { data: rms, error: rmErr }] = await Promise.all([
        supabase.from('roles').select('id, label, description, is_system').order('id'),
        supabase.from('role_modules').select('role_id, module_id'),
      ])
      if (rErr) throw rErr
      if (rmErr) throw rmErr
      setRoles((rs ?? []) as Role[])
      const m = new Map<string, Set<ModuleId>>()
      for (const row of (rms ?? []) as any[]) {
        const set = m.get(row.role_id) ?? new Set<ModuleId>()
        set.add(row.module_id as ModuleId)
        m.set(row.role_id, set)
      }
      setGrants(m)
    } catch (e: any) {
      setErr(e?.message || 'Load failed')
    }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function toggleModule(roleId: string, moduleId: ModuleId, next: boolean) {
    setBusyKey(`${roleId}:${moduleId}`); setErr(null)
    // Optimistic
    setGrants(prev => {
      const m = new Map(prev)
      const s = new Set(m.get(roleId) ?? [])
      if (next) s.add(moduleId); else s.delete(moduleId)
      m.set(roleId, s); return m
    })
    const { error } = next
      ? await supabase.from('role_modules').insert({ role_id: roleId, module_id: moduleId })
      : await supabase.from('role_modules').delete().eq('role_id', roleId).eq('module_id', moduleId)
    setBusyKey(null)
    if (error) {
      setErr(`${roleId} → ${moduleId}: ${error.message}`)
      // Rollback
      setGrants(prev => {
        const m = new Map(prev)
        const s = new Set(m.get(roleId) ?? [])
        if (next) s.delete(moduleId); else s.add(moduleId)
        m.set(roleId, s); return m
      })
    }
  }

  async function createRole(form: { id: string; label: string; description: string }) {
    setBusyKey('__create__'); setErr(null)
    const { error } = await supabase.from('roles').insert({
      id: form.id.trim().toLowerCase(),
      label: form.label.trim(),
      description: form.description.trim() || null,
      is_system: false,
    })
    setBusyKey(null)
    if (error) { setErr(`Create failed: ${error.message}`); return false }
    await load()
    return true
  }

  async function deleteRole(roleId: string) {
    if (!confirm(`Delete the "${roleId}" role? Any users still on it will block the delete.`)) return
    setBusyKey(`__delete__${roleId}`); setErr(null)
    const { error } = await supabase.from('roles').delete().eq('id', roleId)
    setBusyKey(null)
    if (error) { setErr(`Delete failed: ${error.message}`); return }
    await load()
  }

  if (loading) return <div style={{ color: 'var(--mist)', fontSize: 13 }}>Loading roles…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--mist)', lineHeight: 1.5 }}>
        Each role's module set decides which sidebar items the role's users see.
        System roles (badge: <em>System</em>) cannot be deleted but their modules can be edited.
        Module changes save instantly. Per-user flags (Liberty access, Marketing access, Partner) stay separate from role.
      </div>

      <NewRoleForm onCreate={createRole} busy={busyKey === '__create__'} />

      {err && (
        <div style={{
          background: 'var(--red-pale)', color: '#7f1d1d',
          border: '1px solid #fecaca', borderRadius: 6,
          padding: '6px 10px', fontSize: 12,
        }}>{err}</div>
      )}

      {roles.map(r => {
        const set = grants.get(r.id) ?? new Set<ModuleId>()
        const isOpen = expanded === r.id
        const totalCount = MODULE_SECTIONS.reduce((s, sec) => s + sec.modules.length, 0)
        return (
          <div key={r.id} style={{
            border: '1px solid var(--pearl)', borderRadius: 10, background: '#fff',
          }}>
            <button type="button"
              onClick={() => setExpanded(isOpen ? null : r.id)}
              style={{
                width: '100%', textAlign: 'left',
                background: 'transparent', border: 'none',
                padding: '12px 14px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 10,
                fontFamily: 'inherit',
              }}>
              <span aria-hidden style={{
                width: 14, color: 'var(--mist)', fontSize: 11,
                transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform .15s ease',
              }}>▶</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {r.label}
                  <span style={{
                    fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 99,
                    background: r.is_system ? 'var(--cream2)' : 'var(--green-pale)',
                    color: r.is_system ? 'var(--mist)' : 'var(--green-dark)',
                    textTransform: 'uppercase', letterSpacing: '.05em',
                  }}>{r.is_system ? 'System' : 'Custom'}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--mist)' }}>
                    {set.size}/{totalCount} modules
                  </span>
                </div>
                {r.description && (
                  <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 2 }}>{r.description}</div>
                )}
              </div>
              {!r.is_system && (
                <span
                  role="button" tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); deleteRole(r.id) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); deleteRole(r.id) } }}
                  style={{
                    fontSize: 11, fontWeight: 700, color: 'var(--red)',
                    textDecoration: 'underline', cursor: 'pointer',
                    marginLeft: 6,
                  }}>
                  {busyKey === `__delete__${r.id}` ? '…' : 'Delete'}
                </span>
              )}
            </button>

            {isOpen && (
              <div style={{
                padding: '4px 14px 14px', borderTop: '1px solid var(--cream2)',
                display: 'flex', flexDirection: 'column', gap: 14,
              }}>
                {MODULE_SECTIONS.map(sec => (
                  <div key={sec.label}>
                    <div style={{
                      fontSize: 10, fontWeight: 800, color: 'var(--mist)',
                      textTransform: 'uppercase', letterSpacing: '.06em',
                      marginTop: 12, marginBottom: 6,
                    }}>{sec.label}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                      {sec.modules.map(m => {
                        const granted = set.has(m.id)
                        const busy = busyKey === `${r.id}:${m.id}`
                        return (
                          <label key={m.id}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 8,
                              padding: '8px 10px', borderRadius: 6,
                              border: `1.5px solid ${granted ? 'var(--green)' : 'var(--pearl)'}`,
                              background: granted ? 'var(--green-pale)' : '#fff',
                              cursor: busy ? 'wait' : 'pointer',
                              position: 'relative',
                            }}>
                            <input type="checkbox" checked={granted}
                              disabled={busy}
                              onChange={e => toggleModule(r.id, m.id, e.target.checked)}
                              style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }} />
                            <span aria-hidden style={{
                              width: 16, height: 16, flexShrink: 0, borderRadius: 4,
                              border: `2px solid ${granted ? 'var(--green)' : 'var(--pearl)'}`,
                              background: granted ? 'var(--green)' : '#fff',
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              color: '#fff', fontSize: 11, fontWeight: 900, lineHeight: 1,
                            }}>{granted ? '✓' : ''}</span>
                            <span style={{
                              fontSize: 12, fontWeight: 600,
                              color: granted ? 'var(--green-dark)' : 'var(--ink)',
                            }}>{m.label}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function NewRoleForm({ onCreate, busy }: {
  onCreate: (f: { id: string; label: string; description: string }) => Promise<boolean>
  busy: boolean
}) {
  const [open, setOpen] = useState(false)
  const [id, setId] = useState('')
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')

  const idOk = useMemo(() => /^[a-z][a-z0-9_]{1,30}$/.test(id), [id])
  const labelOk = label.trim().length > 0
  const canSubmit = idOk && labelOk && !busy

  async function submit() {
    if (!canSubmit) return
    const ok = await onCreate({ id, label, description })
    if (ok) { setId(''); setLabel(''); setDescription(''); setOpen(false) }
  }

  if (!open) {
    return (
      <button className="btn-outline btn-sm" style={{ alignSelf: 'flex-start' }}
        onClick={() => setOpen(true)}>
        + New role
      </button>
    )
  }

  return (
    <div style={{
      border: '1px solid var(--pearl)', borderRadius: 10,
      padding: 14, background: 'var(--cream2)',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>New custom role</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <label className="fl">ID (lowercase, snake_case)</label>
          <input type="text" value={id} onChange={e => setId(e.target.value.toLowerCase())}
            placeholder="e.g. ops_lead" />
          <div style={{ fontSize: 10, color: idOk || !id ? 'var(--mist)' : '#7f1d1d', marginTop: 2 }}>
            Letters, digits, underscores. Starts with a letter.
          </div>
        </div>
        <div>
          <label className="fl">Display label</label>
          <input type="text" value={label} onChange={e => setLabel(e.target.value)}
            placeholder="e.g. Ops Lead" />
        </div>
      </div>
      <div>
        <label className="fl">Description (optional)</label>
        <input type="text" value={description} onChange={e => setDescription(e.target.value)}
          placeholder="What does this role do?" />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn-primary btn-sm" disabled={!canSubmit} onClick={submit}>
          {busy ? 'Creating…' : 'Create role'}
        </button>
        <button className="btn-outline btn-sm" onClick={() => { setOpen(false); setId(''); setLabel(''); setDescription('') }}>
          Cancel
        </button>
      </div>
      <div style={{ fontSize: 11, color: 'var(--mist)' }}>
        Role starts with no module access. Toggle modules in the role card after it's created.
      </div>
    </div>
  )
}
