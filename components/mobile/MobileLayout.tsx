'use client'

import { useState, useEffect, useRef } from 'react'
import { useApp } from '@/lib/context'
import { setMobilePreference } from '@/lib/mobile'
import { supabase } from '@/lib/supabase'
import type { NavPage } from '@/app/page'
import LicenseScanner from '@/components/scan/LicenseScanner'

// 4 tabs + center scan button = 5 slots, perfectly balanced
const LEFT_TABS: { id: NavPage; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Home',   icon: '⌂' },
  { id: 'events',    label: 'Events', icon: '◆' },
]
const RIGHT_TABS: { id: NavPage; label: string; icon: string }[] = [
  { id: 'calendar',  label: 'Appts',  icon: '📅' },
  { id: 'travel',    label: 'Travel', icon: '✈️' },
]

interface Props {
  nav: NavPage
  setNav: (n: NavPage) => void
  children: React.ReactNode
}

export default function MobileLayout({ nav, setNav, children }: Props) {
  const { user, brand, setBrand, events } = useApp()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'
  const hasLibertyAccess = user?.liberty_access === true
  const isLiberty = brand === 'liberty'
  const [menuOpen, setMenuOpen] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scanEventId, setScanEventId] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Find the active/upcoming event for this buyer
  const getActiveEventId = (): string | null => {
    if (!events || events.length === 0) return null
    const today = new Date().toISOString().split('T')[0]
    const myEvents = [...events]
      .filter(ev => isAdmin || (ev.workers || []).some((w: any) => w.id === user?.id))
      .sort((a, b) => a.start_date.localeCompare(b.start_date))

    // Active event (today falls within range)
    const active = myEvents.find(ev => {
      const start = ev.start_date
      const days = ev.days?.length || 3
      const end = new Date(start + 'T12:00:00')
      end.setDate(end.getDate() + days)
      return start <= today && today <= end.toISOString().split('T')[0]
    })
    if (active) return active.id

    // Next upcoming
    const upcoming = myEvents.find(ev => ev.start_date >= today)
    if (upcoming) return upcoming.id

    // Most recent
    return myEvents[myEvents.length - 1]?.id || null
  }

  const handleScanPress = () => {
    const eventId = getActiveEventId()
    if (!eventId) {
      alert('No active event found. You need to be assigned to an event to scan IDs.')
      return
    }
    setScanEventId(eventId)
    setScannerOpen(true)
  }

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
    { id: isLiberty ? 'libertyadmin' : 'admin', label: isLiberty ? 'LEB Admin' : 'Admin', icon: '🔧', adminOnly: true },
    { id: 'stores',       label: 'Stores',         icon: '🏪', adminOnly: true },
    { id: 'historical',   label: 'Historical',     icon: '📜', adminOnly: true },
  ]

  const visiblePages = ALL_PAGES.filter(p => !p.adminOnly || isAdmin)

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--page-bg)' }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px',
        paddingTop: 'max(env(safe-area-inset-top), 10px)',
        background: 'var(--sidebar-bg)', color: '#fff',
        borderBottom: '1px solid rgba(255,255,255,.08)',
      }}>
        <button onClick={() => setMenuOpen(true)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer', padding: '4px 8px' }}>☰</button>

        {hasLibertyAccess && (
          <div style={{ display: 'flex', background: 'rgba(255,255,255,.1)', borderRadius: 20, padding: 2 }}>
            <button onClick={() => setBrand('beb')} style={{
              padding: '4px 14px', borderRadius: 18, fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer',
              background: !isLiberty ? 'var(--green)' : 'transparent',
              color: !isLiberty ? '#fff' : 'rgba(255,255,255,.5)',
            }}>BEB</button>
            <button onClick={() => setBrand('liberty')} style={{
              padding: '4px 14px', borderRadius: 18, fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer',
              background: isLiberty ? '#1D3A6B' : 'transparent',
              color: isLiberty ? '#fff' : 'rgba(255,255,255,.5)',
            }}>LEB</button>
          </div>
        )}

        <button onClick={() => { setMobilePreference(false); window.location.reload() }} style={{
          background: 'none', border: 'none', color: 'rgba(255,255,255,.4)', fontSize: 11, fontWeight: 700, cursor: 'pointer',
        }}>
          Desktop
        </button>
      </div>

      {/* Slide-out menu */}
      {menuOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.5)' }} onClick={() => setMenuOpen(false)} />
          <div ref={menuRef} style={{
            position: 'relative', width: 280, background: 'var(--sidebar-bg)', height: '100%',
            paddingTop: 'max(env(safe-area-inset-top), 16px)', zIndex: 1, overflowY: 'auto',
          }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
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

      {/* Bottom tab bar — 5 equal slots: 2 tabs | scan | 2 tabs */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: 'var(--cream)', borderTop: '1px solid var(--pearl)',
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr',
        alignItems: 'end',
        zIndex: 999,
        paddingBottom: 'max(env(safe-area-inset-bottom), 8px)',
        boxShadow: '0 -2px 12px rgba(0,0,0,.12)',
        minHeight: 60,
      }}>
        {LEFT_TABS.map(tab => {
          const active = nav === tab.id
          return (
            <button key={tab.id} onClick={() => setNav(tab.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '10px 4px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <div style={{ fontSize: 22, lineHeight: 1 }}>{tab.icon}</div>
              <div style={{ fontSize: 10, fontWeight: active ? 900 : 500, color: active ? 'var(--green-dark)' : 'var(--mist)' }}>{tab.label}</div>
            </button>
          )
        })}

        {/* Center scan button — raised circle */}
        <button onClick={handleScanPress} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          padding: '0 0 8px 0', position: 'relative',
        }}>
          <div style={{
            width: 52, height: 52,
            borderRadius: '50%',
            background: 'var(--green, #1e5c3a)',
            border: '3px solid var(--cream)',
            boxShadow: '0 2px 12px rgba(0,0,0,.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginTop: -20,
            color: '#fff', fontSize: 22,
          }}>
            🪪
          </div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mist)', marginTop: 2 }}>
            Scan
          </div>
        </button>

        {RIGHT_TABS.map(tab => {
          const active = nav === tab.id
          return (
            <button key={tab.id} onClick={() => setNav(tab.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '10px 4px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <div style={{ fontSize: 22, lineHeight: 1 }}>{tab.icon}</div>
              <div style={{ fontSize: 10, fontWeight: active ? 900 : 500, color: active ? 'var(--green-dark)' : 'var(--mist)' }}>{tab.label}</div>
            </button>
          )
        })}
      </div>

      {/* License Scanner overlay */}
      {scannerOpen && scanEventId && (
        <LicenseScanner
          eventId={scanEventId}
          onClose={() => { setScannerOpen(false); setScanEventId(null) }}
          onComplete={() => {}}
        />
      )}
    </div>
  )
}
