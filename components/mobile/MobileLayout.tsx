'use client'

import { useState, useEffect, useRef } from 'react'
import { useApp } from '@/lib/context'
import { setMobilePreference } from '@/lib/mobile'
import { supabase } from '@/lib/supabase'
import type { NavPage } from '@/app/page'
import LicenseScanner from '@/components/scan/LicenseScanner'

type TabDef = { id: NavPage; label: string; glyph: string }
const LEFT_TABS: TabDef[] = [
  { id: 'dashboard', label: 'Home',   glyph: 'home' },
  { id: 'events',    label: 'Events', glyph: '◆' },
]
const RIGHT_TABS: TabDef[] = [
  { id: 'calendar',  label: 'Appts',  glyph: '📅' },
  { id: 'travel',    label: 'Travel', glyph: '✈️' },
]

/* ── ICONS ── */
function CameraIcon({ size = 34 }: { size?: number }) {
  // Polaroid OneStep — front face. Big concentric lens, rectangle
  // viewfinder top-left, rectangle flash top-right, shutter dot.
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect x="3.5" y="5" width="25" height="22" rx="2.5" stroke="#111" strokeWidth="2.2"/>
      <circle cx="16" cy="17" r="6.5" stroke="#111" strokeWidth="2.2"/>
      <circle cx="16" cy="17" r="4" stroke="#111" strokeWidth="1.4"/>
      <circle cx="16" cy="17" r="1.8" fill="#111"/>
      <circle cx="14.5" cy="15.5" r="0.9" fill="#fff"/>
      <rect x="5.5" y="7.5" width="4.5" height="3" rx="0.4" stroke="#111" strokeWidth="1.8"/>
      <rect x="22" y="7.5" width="4.5" height="3" rx="0.4" stroke="#111" strokeWidth="1.8"/>
      <circle cx="25.5" cy="13.5" r="0.9" fill="#111"/>
    </svg>
  )
}

function HouseIcon({ active }: { active: boolean }) {
  const stroke = active ? 'var(--green-dark)' : 'var(--mist)'
  const accent = 'var(--green)'
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4.5 11V19.5C4.5 19.8 4.7 20 5 20H19C19.3 20 19.5 19.8 19.5 19.5V11"
        stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" style={{ fill: 'var(--cream)' }}/>
      <path d="M3 11.5L12 4L21 11.5Z" style={{ fill: accent }} stroke={stroke} strokeWidth="1.4" strokeLinejoin="round"/>
      <path d="M16 6.5V3.5H18V7.5" stroke={stroke} strokeWidth="1.3" style={{ fill: accent }} strokeLinejoin="round"/>
      <rect x="12.5" y="13" width="3.5" height="3.5" style={{ fill: 'var(--green3)' }} stroke={stroke} strokeWidth="1" rx="0.4"/>
      <rect x="7.5" y="14.5" width="3" height="5.5" style={{ fill: 'none' }} stroke={stroke} strokeWidth="1.2" rx="0.3"/>
    </svg>
  )
}

/* ── SHARED TAB BUTTON ── */
function TabBtn({ tab, active, onClick }: { tab: TabDef; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      background: 'none', border: 'none', cursor: 'pointer',
      padding: '10px 4px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
      color: active ? 'var(--green-dark)' : 'var(--mist)',
    }}>
      {tab.glyph === 'home'
        ? <HouseIcon active={active} />
        : <div style={{ fontSize: 22, lineHeight: 1 }}>{tab.glyph}</div>}
      <div style={{ fontSize: 10, fontWeight: active ? 900 : 500 }}>{tab.label}</div>
    </button>
  )
}

/* ── BOTTOM NAV ── */
function BottomNav({ nav, setNav, onScan }: { nav: NavPage; setNav: (n: NavPage) => void; onScan: () => void }) {
  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 999,
      background: 'var(--cream)',
      borderTop: '1px solid var(--pearl)',
      borderTopLeftRadius: 26, borderTopRightRadius: 26,
      display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr',
      alignItems: 'end',
      paddingBottom: 'max(env(safe-area-inset-bottom), 8px)',
      boxShadow: '0 -4px 18px rgba(0,0,0,.10)', minHeight: 64,
    }}>
      {LEFT_TABS.map(tab => <TabBtn key={tab.id} tab={tab} active={nav === tab.id} onClick={() => setNav(tab.id)} />)}
      <button onClick={onScan} aria-label="Scan" style={{
        background: 'none', border: 'none', cursor: 'pointer',
        display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 0 8px',
      }}>
        <div style={{
          width: 58, height: 58, borderRadius: '50%',
          background: '#fff', border: '3px solid var(--green)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginTop: -18,
          boxShadow: '0 0 0 4px rgba(255,255,255,.9), 0 6px 16px rgba(29,107,68,.28)',
        }}>
          <CameraIcon size={34} />
        </div>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--green-dark)', marginTop: 4, letterSpacing: '.04em' }}>SCAN</div>
      </button>
      {RIGHT_TABS.map(tab => <TabBtn key={tab.id} tab={tab} active={nav === tab.id} onClick={() => setNav(tab.id)} />)}
    </div>
  )
}

interface Props {
  nav: NavPage
  setNav: (n: NavPage) => void
  children: React.ReactNode
}

export default function MobileLayout({ nav, setNav, children }: Props) {
  const { user, brand, setBrand, events, stores } = useApp()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'
  const hasLibertyAccess = user?.liberty_access === true
  const isLiberty = brand === 'liberty'
  const [menuOpen, setMenuOpen] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scanEventId, setScanEventId] = useState<string | null>(null)
  const [eventPickerOpen, setEventPickerOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const getMyEvents = () => {
    if (!events || events.length === 0) return []
    return [...events]
      .filter(ev => isAdmin || (ev.workers || []).some((w: any) => w.id === user?.id))
      .sort((a, b) => b.start_date.localeCompare(a.start_date))
  }

  const getActiveEventId = (): string | null => {
    const myEvents = getMyEvents()
    if (myEvents.length === 0) return null
    const today = new Date().toISOString().split('T')[0]
    const active = myEvents.find(ev => {
      const start = ev.start_date
      const days = ev.days?.length || 3
      const end = new Date(start + 'T12:00:00')
      end.setDate(end.getDate() + days)
      return start <= today && today <= end.toISOString().split('T')[0]
    })
    if (active) return active.id
    const sorted = [...myEvents].sort((a, b) => a.start_date.localeCompare(b.start_date))
    const upcoming = sorted.find(ev => ev.start_date >= today)
    if (upcoming) return upcoming.id
    return myEvents[0]?.id || null
  }

  const handleScanPress = () => {
    const myEvents = getMyEvents()
    if (myEvents.length === 0) {
      alert('No events found. You need to be assigned to an event to scan IDs.')
      return
    }
    const autoId = getActiveEventId()
    if (autoId) {
      const today = new Date().toISOString().split('T')[0]
      const ev = myEvents.find(e => e.id === autoId)
      const isToday = ev && ev.start_date <= today
      if (isToday) {
        setScanEventId(autoId)
        setScannerOpen(true)
      } else {
        setEventPickerOpen(true)
      }
    } else {
      setEventPickerOpen(true)
    }
  }

  const selectEventAndScan = (eventId: string) => {
    setEventPickerOpen(false)
    setScanEventId(eventId)
    setScannerOpen(true)
  }

  const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

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
  ]

  const visiblePages = ALL_PAGES.filter(p => !p.adminOnly || isAdmin)

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--page-bg)' }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', paddingTop: 'max(env(safe-area-inset-top), 10px)',
        background: 'var(--sidebar-bg)', color: '#fff',
        borderBottom: '1px solid rgba(255,255,255,.08)',
      }}>
        <button onClick={() => setMenuOpen(true)} aria-label="Open menu" style={{ background: 'none', border: 'none', color: '#fff', fontSize: 24, cursor: 'pointer', padding: '10px 12px', minWidth: 44, minHeight: 44 }}>☰</button>
        {hasLibertyAccess && (
          <div style={{ display: 'flex', background: 'rgba(255,255,255,.1)', borderRadius: 20, padding: 2 }}>
            <button onClick={() => setBrand('beb')} style={{ padding: '4px 14px', borderRadius: 18, fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer', background: !isLiberty ? 'var(--green)' : 'transparent', color: !isLiberty ? '#fff' : 'rgba(255,255,255,.5)' }}>BEB</button>
            <button onClick={() => setBrand('liberty')} style={{ padding: '4px 14px', borderRadius: 18, fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer', background: isLiberty ? '#1D3A6B' : 'transparent', color: isLiberty ? '#fff' : 'rgba(255,255,255,.5)' }}>LEB</button>
          </div>
        )}
        <button onClick={() => { setMobilePreference(false); window.location.reload() }} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.4)', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: '10px 12px', minHeight: 44 }}>Desktop</button>
      </div>

      {/* Slide-out menu */}
      {menuOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.5)' }} onClick={() => setMenuOpen(false)} />
          <div ref={menuRef} style={{ position: 'relative', width: 280, background: 'var(--sidebar-bg)', height: '100%', paddingTop: 'max(env(safe-area-inset-top), 16px)', zIndex: 1, overflowY: 'auto' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
              <div style={{ color: isLiberty ? '#93C5FD' : '#7EC8A0', fontWeight: 900, fontSize: 15 }}>{isLiberty ? '★ Liberty Portal' : '◆ BEB Portal'}</div>
              {user && <div style={{ color: 'rgba(255,255,255,.5)', fontSize: 12, marginTop: 4 }}>{user.name}</div>}
            </div>
            <div style={{ padding: '12px 0' }}>
              {visiblePages.map(p => (
                <button key={p.id} onClick={() => { setNav(p.id); setMenuOpen(false) }} style={{ width: '100%', padding: '14px 20px', background: nav === p.id ? 'rgba(255,255,255,.1)' : 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 12, color: nav === p.id ? '#fff' : 'rgba(255,255,255,.6)', fontWeight: nav === p.id ? 700 : 400, fontSize: 14, textAlign: 'left', borderLeft: nav === p.id ? '3px solid var(--green3)' : '3px solid transparent', minHeight: 44 }}>
                  <span style={{ fontSize: 16, width: 20, textAlign: 'center', flexShrink: 0 }}>{p.icon}</span>{p.label}
                </button>
              ))}
              <div style={{ borderTop: '1px solid rgba(255,255,255,.1)', margin: '12px 0 0' }} />
              <button onClick={() => supabase.auth.signOut()} style={{ width: '100%', padding: '14px 20px', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 12, color: '#FCA5A5', fontWeight: 700, fontSize: 14, textAlign: 'left', minHeight: 44 }}>
                <span style={{ fontSize: 16, width: 20, textAlign: 'center', flexShrink: 0 }}>🚪</span>Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 110 }}>{children}</div>

      <BottomNav nav={nav} setNav={setNav} onScan={handleScanPress} />

      {/* Event picker modal */}
      {eventPickerOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9998, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.5)' }} onClick={() => setEventPickerOpen(false)} />
          <div style={{
            position: 'relative', width: '100%', maxWidth: 500,
            background: 'var(--cream)', borderRadius: '16px 16px 0 0',
            paddingBottom: 'max(env(safe-area-inset-bottom), 16px)',
            maxHeight: '70vh', display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--pearl)' }}>
              <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--ink)' }}>Select Event for Scanning</div>
              <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 4 }}>No event is active today. Choose which event to scan IDs for:</div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
              {getMyEvents().slice(0, 15).map(ev => (
                <button key={ev.id} onClick={() => selectEventAndScan(ev.id)} style={{
                  width: '100%', padding: '14px 16px', marginBottom: 6,
                  background: 'var(--cream2)', border: '1px solid var(--pearl)',
                  borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
                      {ev.store_name || 'Unknown Store'}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 2 }}>
                      {fmtDate(ev.start_date)} · {ev.days?.length || '?'} days
                    </div>
                  </div>
                  <div style={{ fontSize: 18, color: 'var(--green)' }}>→</div>
                </button>
              ))}
              {getMyEvents().length === 0 && (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--mist)', fontSize: 14 }}>
                  No events assigned to you.
                </div>
              )}
            </div>
            <div style={{ padding: '8px 16px' }}>
              <button onClick={() => setEventPickerOpen(false)} style={{
                width: '100%', padding: '12px', borderRadius: 10,
                background: 'none', border: '1px solid var(--pearl)',
                color: 'var(--mist)', fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Scanner */}
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
