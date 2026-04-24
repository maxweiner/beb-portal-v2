'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { User } from '@/types'

type Brand = 'beb' | 'liberty'

const BRAND_META: Record<Brand, { label: string; color: string }> = {
  beb:     { label: 'BEB',     color: '#1D6B44' },
  liberty: { label: 'Liberty', color: '#7C3AED' },
}

export default function ReportRecipients() {
  const [users, setUsers] = useState<User[]>([])
  const [loaded, setLoaded] = useState(false)
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase.from('users')
      .select('id, name, email, role, active, notify_beb, notify_liberty')
      .in('role', ['admin', 'superadmin'])
      .eq('active', true)
      .order('name')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) { setError(error.message); return }
        setUsers((data || []) as User[])
        setLoaded(true)
      })
    return () => { cancelled = true }
  }, [])

  async function toggle(userId: string, brand: Brand, value: boolean) {
    const column = brand === 'beb' ? 'notify_beb' : 'notify_liberty'
    setSavingIds(p => new Set(p).add(userId))
    setError(null)
    // Optimistic update
    setUsers(p => p.map(u => u.id === userId ? { ...u, [column]: value } : u))
    const { error } = await supabase.from('users').update({ [column]: value }).eq('id', userId)
    setSavingIds(p => { const n = new Set(p); n.delete(userId); return n })
    if (error) {
      setError(error.message)
      // Roll back optimistic change
      setUsers(p => p.map(u => u.id === userId ? { ...u, [column]: !value } : u))
    }
  }

  if (!loaded) {
    return (
      <div style={{ padding: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 900 }}>Report Recipients</h2>
        <p style={{ color: 'var(--mist)', marginTop: 8 }}>Loading…</p>
      </div>
    )
  }

  const counts = {
    beb: users.filter(u => u.notify_beb).length,
    liberty: users.filter(u => u.notify_liberty).length,
  }

  return (
    <div style={{ padding: 24, maxWidth: 880 }}>
      <h2 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)', marginBottom: 4 }}>
        Report Recipients
      </h2>
      <p style={{ color: 'var(--mist)', fontSize: 14, marginBottom: 20 }}>
        Choose which users get the morning report for each brand. The cron
        runs daily at 12:00 UTC and sends one email per brand to its
        opted-in recipients.
      </p>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        {(['beb', 'liberty'] as Brand[]).map(b => (
          <div key={b} style={{
            flex: 1, padding: 14, borderRadius: 'var(--r)',
            background: 'white', border: '1px solid var(--pearl)',
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ash)', textTransform: 'uppercase' }}>
              {BRAND_META[b].label} subscribers
            </div>
            <div style={{ fontSize: 28, fontWeight: 900, color: BRAND_META[b].color }}>
              {counts[b]}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div style={{
          padding: 10, marginBottom: 12, borderRadius: 'var(--r)',
          background: '#fee2e2', color: '#991b1b', fontSize: 13,
        }}>
          Save failed: {error}
        </div>
      )}

      <div style={{
        background: 'white', border: '1px solid var(--pearl)',
        borderRadius: 'var(--r)', overflow: 'hidden',
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 100px 100px',
          gap: 0,
          background: 'var(--cream-2)',
          padding: '10px 14px',
          fontSize: 11, fontWeight: 700, color: 'var(--ash)',
          textTransform: 'uppercase', letterSpacing: '.04em',
        }}>
          <span>User</span>
          <span style={{ textAlign: 'center', color: BRAND_META.beb.color }}>BEB report</span>
          <span style={{ textAlign: 'center', color: BRAND_META.liberty.color }}>Liberty report</span>
        </div>

        {users.length === 0 && (
          <div style={{ padding: 18, color: 'var(--mist)', fontSize: 13 }}>
            No active admin or superadmin users.
          </div>
        )}

        {users.map(u => {
          const isSaving = savingIds.has(u.id)
          return (
            <div key={u.id} style={{
              display: 'grid',
              gridTemplateColumns: '1fr 100px 100px',
              gap: 0,
              padding: '10px 14px',
              borderTop: '1px solid var(--pearl)',
              alignItems: 'center',
              opacity: isSaving ? 0.6 : 1,
            }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>
                  {u.name || u.email}
                </div>
                <div style={{ fontSize: 12, color: 'var(--mist)' }}>
                  {u.email} · {u.role}
                </div>
              </div>
              <BrandToggle
                checked={!!u.notify_beb}
                color={BRAND_META.beb.color}
                onChange={v => toggle(u.id, 'beb', v)}
              />
              <BrandToggle
                checked={!!u.notify_liberty}
                color={BRAND_META.liberty.color}
                onChange={v => toggle(u.id, 'liberty', v)}
              />
            </div>
          )
        })}
      </div>

      <p style={{ marginTop: 14, color: 'var(--mist)', fontSize: 12 }}>
        Tip: the morning report is also reachable manually at{' '}
        <code>/api/daily-report?secret=&lt;CRON_SECRET&gt;</code> — append{' '}
        <code>&amp;brand=beb</code> or <code>&amp;brand=liberty</code> to send
        just one brand for testing.
      </p>
    </div>
  )
}

function BrandToggle({ checked, color, onChange }: {
  checked: boolean
  color: string
  onChange: (v: boolean) => void
}) {
  return (
    <label style={{ display: 'flex', justifyContent: 'center', cursor: 'pointer' }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }}
      />
      <span aria-hidden="true" style={{
        width: 22, height: 22, flexShrink: 0, borderRadius: 5,
        border: `2px solid ${checked ? color : 'var(--pearl)'}`,
        background: checked ? color : '#FFFFFF',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#FFFFFF', fontSize: 14, fontWeight: 900, lineHeight: 1,
        transition: 'all .15s ease',
      }}>
        {checked ? '✓' : ''}
      </span>
    </label>
  )
}
