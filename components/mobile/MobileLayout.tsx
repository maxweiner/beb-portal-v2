'use client'

import { useState, useEffect, useRef } from 'react'
import { useApp } from '@/lib/context'
import { setMobilePreference } from '@/lib/mobile'
import { supabase } from '@/lib/supabase'
import type { NavPage } from '@/app/page'
import LicenseScanner from '@/components/scan/LicenseScanner'
import { useCenterButtonMode } from '@/lib/centerButtonMode'
import { usePendingApprovals } from '@/components/expenses/usePendingApprovals'
import { useRoleModules } from '@/lib/useRoleModules'
import ViewAsSwitcher from '@/components/impersonation/ViewAsSwitcher'

/* ── ICONS ── */

function MenuIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" aria-hidden>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  )
}

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

/* ── BOTTOM-NAV ICON SET — thick outline in each tab's brand color.
   Selection is shown by a colored halo + lift behind the active icon,
   not by graying the others out. */

const NAV_TAB_COLORS: Record<string, string> = {
  dashboard: '#F97316', // Home   — orange
  events:    '#A855F7', // Events — purple
  dayentry:  '#22C55E', // Enter  — green
  calendar:  '#3B82F6', // Appts  — blue
}

function NavHomeIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <path d="M5 14L16 4L27 14V26C27 27.1 26.1 28 25 28H7C5.9 28 5 27.1 5 26V14Z" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M12 28V18H20V28" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
  )
}

function NavEventsIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect x="4" y="7" width="24" height="21" rx="3" stroke={color} strokeWidth="3" strokeLinecap="round"/>
      <path d="M4 13H28" stroke={color} strokeWidth="3" strokeLinecap="round"/>
      <line x1="10" y1="4" x2="10" y2="10" stroke={color} strokeWidth="3" strokeLinecap="round"/>
      <line x1="22" y1="4" x2="22" y2="10" stroke={color} strokeWidth="3" strokeLinecap="round"/>
    </svg>
  )
}

function NavEnterIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <path d="M22 4L26 8L14 20H10V16L22 4Z" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M19 7L23 11" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="6" y1="28" x2="26" y2="28" stroke={color} strokeWidth="3" strokeLinecap="round"/>
      <line x1="10" y1="24" x2="18" y2="24" stroke={color} strokeWidth="2" strokeLinecap="round" opacity=".5"/>
    </svg>
  )
}

function NavApptsIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <circle cx="16" cy="16" r="11" stroke={color} strokeWidth="3"/>
      <path d="M16 9V16.5L20 19" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

type TabDef = { id: NavPage; label: string; kind: 'home' | 'events' | 'enter' | 'appts' }
const LEFT_TABS: TabDef[] = [
  { id: 'dashboard', label: 'Home',   kind: 'home' },
  { id: 'events',    label: 'Events', kind: 'events' },
]
const RIGHT_TABS: TabDef[] = [
  { id: 'dayentry',  label: 'Enter',  kind: 'enter' },
  { id: 'calendar',  label: 'Appts',  kind: 'appts' },
]

function renderNavIcon(kind: TabDef['kind'], color: string, size: number) {
  switch (kind) {
    case 'home':   return <NavHomeIcon   size={size} color={color} />
    case 'events': return <NavEventsIcon size={size} color={color} />
    case 'enter':  return <NavEnterIcon  size={size} color={color} />
    case 'appts':  return <NavApptsIcon  size={size} color={color} />
  }
}

/* ── SHARED TAB BUTTON ──
   Icon is always the tab's brand color. Selection = a colored halo
   (tinted chip + soft drop shadow + small lift) under the icon. */
function TabBtn({ tab, active, onClick }: { tab: TabDef; active: boolean; onClick: () => void }) {
  const accent = NAV_TAB_COLORS[tab.id] || '#22C55E'
  return (
    <button onClick={onClick} style={{
      background: 'none', border: 'none', cursor: 'pointer',
      padding: '6px 4px 6px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: 14,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: active ? `${accent}22` : 'transparent',
        boxShadow: active
          ? `0 6px 14px -4px ${accent}88, inset 0 0 0 1.5px ${accent}44`
          : 'none',
        transform: active ? 'translateY(-2px)' : 'none',
        transition: 'background .18s ease, box-shadow .18s ease, transform .18s ease',
      }}>
        {renderNavIcon(tab.kind, accent, 28)}
      </div>
      <div style={{
        fontSize: 10,
        fontWeight: active ? 900 : 600,
        color: accent,
        letterSpacing: '.02em',
      }}>{tab.label}</div>
    </button>
  )
}

/* ── BOTTOM NAV ── */
function BottomNav({ nav, setNav, onScan, centerMode }: {
  nav: NavPage
  setNav: (n: NavPage) => void
  onScan: () => void
  centerMode: 'travel' | 'scan'
}) {
  const isScan = centerMode === 'scan'
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
      <button
        onClick={isScan ? onScan : () => setNav('travel')}
        aria-label={isScan ? 'Scan' : 'Travel'}
        style={{
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
          {isScan ? <CameraIcon size={34} /> : <span style={{ fontSize: 30, lineHeight: 1 }} aria-hidden>✈️</span>}
        </div>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--green-dark)', marginTop: 4, letterSpacing: '.04em' }}>
          {isScan ? 'SCAN' : 'TRAVEL'}
        </div>
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
  const centerMode = useCenterButtonMode(events, user?.id)
  // Still used by getMyEvents() to pick "all events" for admins;
  // PR D will replace with a more granular permission check.
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'
  const hasLibertyAccess = user?.liberty_access === true
  const isLiberty = brand === 'liberty'
  const { modules: grantedModules, loaded: modulesLoaded } = useRoleModules()
  const [menuOpen, setMenuOpen] = useState(false)
  const { count: pendingApprovalCount } = usePendingApprovals()
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

  // Slide-out menu mirrors the center-button swap: whichever isn't in
  // the prominent center button shows up in the menu in the OTHER's
  // slot, so both are always reachable without ever appearing in both
  // places at once. Camera/Scan has no real route — tapping it from the
  // menu just runs the scan handler (handled below in onClick).
  const swapItem: { id: NavPage; label: string; icon: string; isScan?: boolean } = centerMode === 'scan'
    ? { id: 'travel', label: 'Travel Share', icon: '✈️' }
    : { id: 'dashboard' as NavPage, label: 'Scan ID', icon: '📷', isScan: true }

  const ALL_PAGES: { id: NavPage; label: string; icon: string; isScan?: boolean }[] = [
    { id: 'dashboard',    label: 'Dashboard',           icon: '⌂' },
    { id: 'events',       label: 'Events',              icon: '◆' },
    { id: 'dayentry',     label: 'Enter Buying Data',   icon: '📝' },
    { id: 'calendar',     label: 'Buying Bookings',     icon: '📅' },
    { id: 'schedule',     label: 'Calendar',            icon: '🗓' },
    swapItem,
    { id: 'staff',        label: 'Staff',               icon: '👥' },
    { id: 'trade-shows',       label: 'Trade Shows',         icon: '🎪' },
    { id: 'trunk-shows',       label: 'Trunk Shows',         icon: '🛍️' },
    { id: 'trunk-show-stores', label: 'Trunk Show Stores',   icon: '🏬' },
    { id: 'leads',             label: 'Leads',               icon: '🎯' },
    { id: 'shipping',     label: 'Shipping',            icon: '📦' },
    { id: 'reports',      label: 'Reports',             icon: '📊' },
    { id: 'expenses',     label: 'Expenses',            icon: '🧾' },
    { id: 'financials',   label: 'Financials',          icon: '💼' },
    { id: 'marketing',    label: 'Marketing',           icon: '📣' },
    { id: 'settings',     label: 'Settings',            icon: '⚙️' },
    { id: isLiberty ? 'libertyadmin' : 'admin', label: isLiberty ? 'LEB Admin' : 'Admin', icon: '🔧' },
    { id: 'stores',       label: 'Stores',              icon: '🏪' },
  ]

  // role_modules drives access. Hide everything until modules load
  // so we don't briefly flash an over-permissive list.
  const visiblePages = modulesLoaded
    ? ALL_PAGES.filter(p => grantedModules.has(p.id))
    : []

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--page-bg)' }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', paddingTop: 'max(env(safe-area-inset-top), 10px)',
        background: 'var(--sidebar-bg)', color: '#fff',
        borderBottom: '1px solid rgba(255,255,255,.08)',
      }}>
        <button onClick={() => setMenuOpen(true)} aria-label="Open menu" style={{
          background: 'rgba(255,255,255,0.2)',
          borderRadius: 8, padding: '6px 12px', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 8,
          minWidth: 44, minHeight: 44, color: '#fff',
        }}>
          <MenuIcon size={18} />
          <span style={{ color: '#fff', fontSize: 13, fontWeight: 700 }}>Menu</span>
        </button>
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
                <button
                  key={`${p.id}-${p.label}`}
                  onClick={() => {
                    setMenuOpen(false)
                    if (p.isScan) handleScanPress()
                    else setNav(p.id)
                  }}
                  style={{ width: '100%', padding: '14px 20px', background: !p.isScan && nav === p.id ? 'rgba(255,255,255,.1)' : 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 12, color: !p.isScan && nav === p.id ? '#fff' : 'rgba(255,255,255,.6)', fontWeight: !p.isScan && nav === p.id ? 700 : 400, fontSize: 14, textAlign: 'left', borderLeft: !p.isScan && nav === p.id ? '3px solid var(--green3)' : '3px solid transparent', minHeight: 44 }}
                >
                  <span style={{ fontSize: 16, width: 20, textAlign: 'center', flexShrink: 0 }}>{p.icon}</span>
                  <span style={{ flex: 1 }}>{p.label}</span>
                  {p.id === 'expenses' && pendingApprovalCount > 0 && (
                    <span style={{ background: '#DC2626', color: '#fff', borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 800, minWidth: 20, textAlign: 'center' }}>
                      {pendingApprovalCount}
                    </span>
                  )}
                </button>
              ))}
              <div style={{ borderTop: '1px solid rgba(255,255,255,.1)', margin: '12px 0 0' }} />
              <ViewAsSwitcher variant="mobile" />
              <button onClick={() => supabase.auth.signOut()} style={{ width: '100%', padding: '14px 20px', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 12, color: '#FCA5A5', fontWeight: 700, fontSize: 14, textAlign: 'left', minHeight: 44 }}>
                <span style={{ fontSize: 16, width: 20, textAlign: 'center', flexShrink: 0 }}>🚪</span>Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 110 }}>{children}</div>

      <BottomNav nav={nav} setNav={setNav} onScan={handleScanPress} centerMode={centerMode} />

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
