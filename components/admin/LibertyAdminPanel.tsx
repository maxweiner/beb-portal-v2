'use client'

import { useState, useEffect } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'

export default function LibertyAdminPanel() {
  const { user: currentUser } = useApp()
  const [users, setUsers] = useState<any[]>([])
  const [saving, setSaving] = useState<string | null>(null)

  const INELIGIBLE = ['joe', 'max']

  const loadUsers = async () => {
    try {
      const { data, error } = await supabase.from('users').select('*').order('name')
      if (error) console.error('[LibertyAdmin] error:', error)
      setUsers(data || [])
    } catch (e) {
      console.error('[LibertyAdmin] exception:', e)
    }
  }

  useEffect(() => { loadUsers() }, [])

  const toggleLibertyAccess = async (userId: string, current: boolean) => {
    const u = users.find(u => u.id === userId)
    if (!u) return
    const isProtected = INELIGIBLE.some(n => u.name?.toLowerCase().includes(n))
    if (isProtected) return

    setSaving(userId)
    await supabase.from('users').update({ liberty_access: !current }).eq('id', userId)
    await loadUsers()
    setSaving(null)
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div style={{ marginBottom: 24 }}>
        <h1 className="text-2xl font-black" style={{ color: 'var(--ink)' }}>★ Liberty Admin Panel</h1>
        <p style={{ color: 'var(--mist)', fontSize: 14, marginTop: 4 }}>
          Control which buyers have access to Liberty Estate Buyers. Activated users can see the brand switcher and all Liberty data.
        </p>
      </div>

      <div style={{ background: 'var(--green-pale)', border: '1px solid var(--green3)', borderRadius: 12, padding: '14px 18px', marginBottom: 24, fontSize: 13, color: 'var(--green-dark)' }}>
        <strong>How it works:</strong> Users with Liberty Access turned ON will see the BEB | LIBERTY switcher in the sidebar. When they switch to Liberty, they only see Liberty stores, events, leaderboard, and reports. Max and Joe always have access.
      </div>

      <div style={{ background: 'var(--card-bg)', borderRadius: 14, border: '1px solid var(--pearl)', overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--pearl)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 900, fontSize: 14, color: 'var(--ink)' }}>Buyer Access</div>
          <div style={{ fontSize: 12, color: 'var(--mist)' }}>
            {users.filter(u => u.liberty_access).length} of {users.length} users have access
          </div>
        </div>

        {users.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--mist)' }}>Loading users…</div>
        )}

        {users.map((u, i) => {
          const isProtected = INELIGIBLE.some(n => u.name?.toLowerCase().includes(n))
          const hasAccess = u.liberty_access === true
          const isSaving = saving === u.id

          return (
            <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px', borderBottom: i < users.length - 1 ? '1px solid var(--cream2)' : 'none', background: i % 2 === 0 ? 'transparent' : 'var(--cream2)' }}>
              <div style={{ width: 38, height: 38, borderRadius: '50%', flexShrink: 0, background: hasAccess ? 'var(--green)' : 'var(--pearl)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: hasAccess ? '#fff' : 'var(--mist)', fontWeight: 900, fontSize: 15 }}>
                {u.name?.charAt(0) || '?'}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  {u.name}
                  {isProtected && <span style={{ fontSize: 10, fontWeight: 700, background: 'var(--green)', color: '#fff', padding: '2px 8px', borderRadius: 99 }}>Always On</span>}
                  {!u.active && <span style={{ fontSize: 10, color: 'var(--mist)', fontWeight: 400 }}>inactive</span>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 2 }}>
                  {u.email} · {u.role}{u.is_buyer && ' · Buyer'}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: hasAccess ? 'var(--green)' : 'var(--mist)' }}>
                  {hasAccess ? 'Access On' : 'No Access'}
                </span>
                <button onClick={() => toggleLibertyAccess(u.id, hasAccess)} disabled={isProtected || isSaving}
                  style={{ width: 44, height: 24, borderRadius: 12, border: 'none', cursor: isProtected ? 'default' : 'pointer', background: hasAccess ? 'var(--green)' : 'var(--pearl)', position: 'relative', transition: 'background .2s', flexShrink: 0, opacity: isProtected ? 0.6 : 1 }}>
                  <div style={{ position: 'absolute', top: 3, left: hasAccess ? 23 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ background: 'var(--card-bg)', borderRadius: 14, border: '1px solid var(--pearl)', overflow: 'hidden', marginTop: 24 }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--pearl)', fontWeight: 900, fontSize: 14, color: 'var(--ink)' }}>Liberty Themes</div>
        <div style={{ padding: 20, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          {[
            { label: 'Navy Classic',   colors: ['#0F172A', '#1D3A6B', '#93C5FD', '#FFFFFF'] },
            { label: 'Navy & Gold',    colors: ['#0F172A', '#1D3A6B', '#F5C400', '#FFFDF5'] },
            { label: 'Slate Steel',    colors: ['#1E293B', '#334155', '#7DD3FC', '#F8FAFC'] },
            { label: 'Red White Blue', colors: ['#3C3B6E', '#B22234', '#FFFFFF', '#F0F0FF'] },
          ].map(theme => (
            <div key={theme.label} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, border: '1px solid var(--pearl)', background: 'var(--cream2)' }}>
              <div style={{ display: 'flex', gap: 4 }}>
                {theme.colors.map((c, i) => <div key={i} style={{ width: 16, height: 16, borderRadius: 4, background: c, border: '1px solid rgba(0,0,0,.1)' }} />)}
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{theme.label}</span>
            </div>
          ))}
        </div>
        <div style={{ padding: '0 20px 16px', fontSize: 12, color: 'var(--mist)' }}>Users can select their Liberty theme in Settings → Appearance.</div>
      </div>
    </div>
  )
}
