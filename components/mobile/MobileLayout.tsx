'use client'

import { useState, useEffect, useRef } from 'react'
import { useApp } from '@/lib/context'
import { setMobilePreference } from '@/lib/mobile'
import { supabase } from '@/lib/supabase'
import type { NavPage } from '@/app/page'

const TABS: { id: NavPage; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Home',   icon: '⌂' },
  { id: 'events',    label: 'Events', icon: '◆' },
  { id: 'dayentry',  label: 'Enter',  icon: '📝' },
  { id: 'calendar',  label: 'Appts',  icon: '📅' },
  { id: 'travel',    label: 'Travel', icon: '✈️' },
]

interface Props {
  nav: NavPage
  setNav: (n: NavPage) => void
  children: React.ReactNode
}

export default function MobileLayout({ nav, setNav, children }: Props) {
  const { user, brand, setBrand } = useApp()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'
  const hasLibertyAccess = user?.liberty_access === true
  const isLiberty = brand === 'liberty'
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const ALL_PAGES: { id: NavPage; label: string; icon: string; adminOnly?: boolean }[] = [
    { id: 'dashboard',    label: 'Dashboard',      icon: '⌂' },
    { id: 'events',       label: 'Events',         icon: '◆' },
    { id: 'dayentry',     label: 'Enter Day Data', icon: '📝' },
    { id: 'calendar',     label: 'Appointments',   icon: '📅' },
    { id: 'schedule',     label: 'Calendar',       icon: '🗓' },
    { id: 'travel',       label: 'Travel Share',   icon: '✈️' },
    { id: 'staff',        label: 'Staff',          icon: '👥' },
    { id: 'shipping',     label: 'Shipping',       icon: '📦' },
    { id: 'reports',      label: 'Reports',        icon: '📊' },
    { id: 'marketing',    label: 'Marketing',      icon: '📣' },
    { id: 'settings',     label: 'Settings',       icon: '⚙️' },
    { id: isLiberty ? 'libertyadmin' : 'admin', label: isLiberty ? 'Liberty Admin' : 'Admin Panel', icon: '🔧', adminOnly: true },
    { id: 'stores',       label: 'Stores',         icon: '🏪', adminOnly: true },
    { id: 'historical',   label: 'Historical',     icon: '📚', adminOnly: true },
  ]

  const visiblePages = ALL_PAGES.filter(p => !p.adminOnly || isAdmin)

  return (
    <div style={{ minHeight: '100vh', height: '100%', background: 'var(--cream2)', display: 'flex', flexDirection: 'column', fontFamily: 'Lato, sans-serif', position: 'relative' }}>
      <div style={{ background: 'var(--sidebar-bg)', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100, boxShadow: '0 2px 8px rgba(0,0,0,.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ color: isLiberty ? '#93C5FD' : '#7EC8A0', fontWeight: 900, fontSize: 16 }}>
            {isLiberty ? '★ Liberty' : '◆ BEB Portal'}
          </div>
          {hasLibertyAccess && (
            <div style={{ background: 'rgba(0,0,0,.25)', borderRadius: 8, padding: 2, display: 'flex', gap: 1 }}>
              <button onClick={() => { setBrand('beb'); setNav('dashboard') }} style={{ padding: '3px 8px', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 900, fontSize: 10, background: !isLiberty ? '#7EC8A0' : 'transparent', color: !isLiberty ? '#0F2D1F' : 'rgba(255,255,255,.45)' }}>BEB</button>
              <button onClick={() => { setBrand('liberty'); setNav('dashboard') }} style={{ padding: '3px 8px', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 900, fontSize: 10, background: isLiberty ? '#93C5FD' : 'transparent', color: isLiberty ? '#0F172A' : 'rgba(255,255,255,.45)' }}>LEB</button>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => { setMobilePreference(false); window.location.reload() }} style={{ background: 'rgba(255,255,255,.12)', border: 'none', color: 'rgba(255,255,255,.7)', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 99, cursor: 'pointer' }}>🖥 Desktop</button>
          <button onClick={() => setMenuOpen(!menuOpen)} style={{ background: 'rgba(255,255,255,.12)', border: 'none', color: '#fff', width: 36, height: 36, borderRadius: 8, cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>☰</button>
        </div>
      </div>

      {menuOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,.5)' }}>
          <div ref={menuRef} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 260, background: 'var(--sidebar-bg)', overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,.3)' }}>
            <div style={{ padding: '20px 20px 12px', borderBottom: '1px solid rgba(255,255,255,.1)' }}>
              <div style={{ color: isLiberty ? '#93C5FD' : '#7EC8A0', fontWeight: 900, fontSize: 15 }}>{isLiberty ? '★ Liberty Portal' : '◆ BEB Portal'}</div>
              {user && <div style={{ color: 'rgba(255,255,255,.5)', fontSize: 12, marginTop: 4 }}>{user.name}</div>}
            </div>
            <div style={{ padding: '12px 0' }}>
              {visiblePages.map(p => (
                <button key={p.id} onClick={() => { setNav(p.id); setMenuOpen(false) }} style={{ width: '100%', padding: '12px 20px', background: nav === p.id ? 'rgba(255,255,255,.1)' : 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, color: nav === p.id ? '#fff' : 'rgba(255,255,255,.6)', fontWeight: nav === p.id ? 700 : 400, fontSize: 14, textAlign: 'left', borderLeft: nav === p.id ? '3px solid var(--green3)' : '3px solid transparent' }}>
                  <span style={{ fontSize: 16 }}>{p.icon}</span>
                  {p.label}
                </button>
              ))}
              <div style={{ borderTop: '1px solid rgba(255,255,255,.1)', margin: '12px 0 0' }} />
              <button onClick={() => supabase.auth.signOut()} style={{ width: '100%', padding: '14px 20px', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, color: '#FCA5A5', fontWeight: 700, fontSize: 14, textAlign: 'left' }}>
                <span style={{ fontSize: 16 }}>🚪</span>
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 100 }}>{children}</div>

      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'var(--cream)', borderTop: '1px solid var(--pearl)', display: 'flex', zIndex: 999, paddingBottom: 'max(env(safe-area-inset-bottom), 8px)', boxShadow: '0 -2px 12px rgba(0,0,0,.12)', minHeight: 60 }}>
        {TABS.map(tab => {
          const active = nav === tab.id
          return (
            <button key={tab.id} onClick={() => setNav(tab.id)} style={{ flex: 1, background: 'none', border: 'none', cursor: 'pointer', padding: '10px 4px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <div style={{ fontSize: 22, lineHeight: 1 }}>{tab.icon}</div>
              <div style={{ fontSize: 10, fontWeight: active ? 900 : 500, color: active ? 'var(--green)' : 'var(--mist)' }}>{tab.label}</div>
              {active && <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--green)' }} />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
