'use client'

import { useEffect, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type { NavPage } from '@/app/page'

const COLLAPSE_KEY = 'beb-sidebar-collapsed'

const ICONS: Record<string, JSX.Element> = {
  dashboard: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="6" height="6" rx="1" fill="currentColor" opacity=".9"/><rect x="9" y="1" width="6" height="6" rx="1" fill="currentColor" opacity=".9"/><rect x="1" y="9" width="6" height="6" rx="1" fill="currentColor" opacity=".9"/><rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" opacity=".9"/></svg>,
  calendar:  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="3" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M1 7h14" stroke="currentColor" strokeWidth="1.5"/><path d="M5 1v4M11 1v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  events:    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5"/><circle cx="8" cy="8" r="2.5" fill="currentColor"/></svg>,
  dayentry:  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><rect x="9" y="2" width="6" height="4" rx="1" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/><path d="M9 14l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  admin:     <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="6" cy="5" r="3" stroke="currentColor" strokeWidth="1.5"/><path d="M1 14c0-3 2-5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M11 9l1.5 1.5L15 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5"/></svg>,
  stores:    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 6.5L8 2l6 4.5V14a1 1 0 01-1 1H3a1 1 0 01-1-1V6.5z" stroke="currentColor" strokeWidth="1.5"/><path d="M6 15V9h4v6" stroke="currentColor" strokeWidth="1.5"/></svg>,
  marketing: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 5h9l3 3-3 3H2l2-3-2-3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="M2 8h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  shipping:  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="4" width="10" height="8" rx="1" stroke="currentColor" strokeWidth="1.5"/><path d="M11 6h2l2 3v3h-4V6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><circle cx="4" cy="13" r="1.5" fill="currentColor"/><circle cx="12" cy="13" r="1.5" fill="currentColor"/></svg>,
  reports:   <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><path d="M5 10V8M8 10V6M11 10V4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  travel:    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1L10 6H15L11 9.5L12.5 15L8 11.5L3.5 15L5 9.5L1 6H6L8 1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>,
  schedule:  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="3" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M1 7h14" stroke="currentColor" strokeWidth="1.5"/><path d="M5 1v4M11 1v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="5" cy="10" r="1" fill="currentColor"/><circle cx="8" cy="10" r="1" fill="currentColor"/><circle cx="11" cy="10" r="1" fill="currentColor"/></svg>,
  staff:     <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="5" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.5"/><circle cx="11" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.5"/><path d="M1 14c0-2.5 1.8-4 4-4s4 1.5 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M11 10c1.5 0 4 .8 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  settings:  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
}

interface NavItem {
  id?: NavPage
  label: string
  iconKey?: string
  section?: boolean
  adminOnly?: boolean
  superadminOnly?: boolean
}

const BEB_NAV: NavItem[] = [
  { label: 'Daily', section: true },
  { id: 'dashboard',    label: 'Dashboard',      iconKey: 'dashboard' },
  { id: 'calendar',     label: 'Appointments',   iconKey: 'calendar' },
  { id: 'events',       label: 'Events',         iconKey: 'events' },
  { id: 'schedule',     label: 'Calendar',       iconKey: 'schedule' },
  { id: 'travel',       label: 'Travel Share',   iconKey: 'travel' },
  { id: 'dayentry',     label: 'Enter Day Data', iconKey: 'dayentry' },
  { id: 'staff',        label: 'Staff',          iconKey: 'staff' },
  { label: 'Admin', section: true },
  { id: 'admin',        label: 'Admin Panel',    iconKey: 'admin',      adminOnly: true },
  { id: 'stores',       label: 'Stores',         iconKey: 'stores',     adminOnly: true },
  { id: 'data-research', label: 'Data Research', iconKey: 'reports',    adminOnly: true },
  { id: 'recipients',   label: 'Report Recipients', iconKey: 'settings', superadminOnly: true },
  { id: 'notification-templates', label: 'Notification Templates', iconKey: 'settings', superadminOnly: true },
  { label: 'Tools', section: true },
  { id: 'marketing',    label: 'Marketing',      iconKey: 'marketing' },
  { id: 'shipping',     label: 'Shipping',       iconKey: 'shipping' },
  { id: 'reports',      label: 'Reports',        iconKey: 'reports' },
  { id: 'settings',     label: 'Settings',       iconKey: 'settings' },
]

const LIBERTY_NAV: NavItem[] = [
  { label: 'Daily', section: true },
  { id: 'dashboard',    label: 'Dashboard',      iconKey: 'dashboard' },
  { id: 'calendar',     label: 'Appointments',   iconKey: 'calendar' },
  { id: 'events',       label: 'Events',         iconKey: 'events' },
  { id: 'schedule',     label: 'Calendar',       iconKey: 'schedule' },
  { id: 'travel',       label: 'Travel Share',   iconKey: 'travel' },
  { id: 'dayentry',     label: 'Enter Day Data', iconKey: 'dayentry' },
  { id: 'staff',        label: 'Staff',          iconKey: 'staff' },
  { label: 'Admin', section: true },
  { id: 'libertyadmin', label: 'Liberty Admin',  iconKey: 'admin',      adminOnly: true },
  { id: 'stores',       label: 'Stores',         iconKey: 'stores',     adminOnly: true },
  { id: 'data-research', label: 'Data Research', iconKey: 'reports',    adminOnly: true },
  { id: 'recipients',   label: 'Report Recipients', iconKey: 'settings', superadminOnly: true },
  { id: 'notification-templates', label: 'Notification Templates', iconKey: 'settings', superadminOnly: true },
  { label: 'Tools', section: true },
  { id: 'marketing',    label: 'Marketing',      iconKey: 'marketing' },
  { id: 'shipping',     label: 'Shipping',       iconKey: 'shipping' },
  { id: 'reports',      label: 'Reports',        iconKey: 'reports' },
  { id: 'settings',     label: 'Settings',       iconKey: 'settings' },
]

interface SidebarProps {
  nav: NavPage
  setNav: (n: NavPage) => void
}

export default function Sidebar({ nav, setNav }: SidebarProps) {
  const { user, brand, setBrand } = useApp()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'
  const isSuperadmin = user?.role === 'superadmin'
  const hasLibertyAccess = user?.liberty_access === true
  const isLiberty = brand === 'liberty'
  const NAV_ITEMS = isLiberty ? LIBERTY_NAV : BEB_NAV

  // Per-section collapse state, persisted to localStorage. Default = all open.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(COLLAPSE_KEY)
      if (raw) setCollapsed(new Set(JSON.parse(raw)))
    } catch { /* ignore */ }
  }, [])
  const toggleSection = (label: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label); else next.add(label)
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next]))
      }
      return next
    })
  }

  return (
    <aside className="sidebar">
      {/* Brand Switcher — only for liberty-enabled users */}
      {hasLibertyAccess && (
        <div style={{ margin: '10px 12px 0', background: 'rgba(0,0,0,.25)', borderRadius: 10, padding: 3, display: 'flex', gap: 2 }}>
          <button onClick={() => setBrand('beb')} style={{
            flex: 1, padding: '5px 0', border: 'none', borderRadius: 7, cursor: 'pointer',
            fontWeight: 900, fontSize: 11, letterSpacing: '.05em',
            background: !isLiberty ? '#7EC8A0' : 'transparent',
            color: !isLiberty ? '#0F2D1F' : 'rgba(255,255,255,.45)',
            transition: 'all .15s',
          }}>BEB</button>
          <button onClick={() => setBrand('liberty')} style={{
            flex: 1, padding: '5px 0', border: 'none', borderRadius: 7, cursor: 'pointer',
            fontWeight: 900, fontSize: 11, letterSpacing: '.05em',
            background: isLiberty ? '#93C5FD' : 'transparent',
            color: isLiberty ? '#0F172A' : 'rgba(255,255,255,.45)',
            transition: 'all .15s',
          }}>LIBERTY</button>
        </div>
      )}

      {/* Logo */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-row">
          {isLiberty
            ? <svg width="14" height="14" viewBox="0 0 14 14" fill="#93C5FD"><polygon points="7,0 8.8,5 14,5 9.8,8 11.5,14 7,10.5 2.5,14 4.2,8 0,5 5.2,5"/></svg>
            : <svg width="14" height="14" viewBox="0 0 14 14" fill="#7EC8A0"><path d="M7 0l2.5 4.5H14L10.5 7 12 12 7 9 2 12l1.5-5L0 4.5h4.5L7 0z"/></svg>
          }
          <span className="app-name">{isLiberty ? 'LibertyOS' : 'BeneficialOS'}</span>
        </div>
        <span className="app-sub">{isLiberty ? 'Liberty Portal' : 'Buyer Portal'}</span>
      </div>

      {/* Nav */}
      <nav className="sidebar-nav">
        {(() => {
          // Walk the flat list, tracking the current section. Items only
          // render when their section is open. Section headers are buttons
          // that toggle the open/closed state.
          let currentSection: string | null = null
          let currentOpen = true
          return NAV_ITEMS.map((item, i) => {
            if (item.section) {
              currentSection = item.label
              currentOpen = !collapsed.has(item.label)
              return (
                <button
                  key={`section-${i}`}
                  type="button"
                  onClick={() => toggleSection(item.label)}
                  className="nav-group-label"
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    width: '100%', textAlign: 'left', display: 'block',
                  }}
                >
                  <span style={{
                    display: 'inline-block', width: 10, marginRight: 4,
                    fontSize: 9,
                    transition: 'transform .15s ease',
                    transform: currentOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                  }}>▶</span>
                  {item.label}
                </button>
              )
            }
            if (item.adminOnly && !isAdmin) return null
            if (item.superadminOnly && !isSuperadmin) return null
            if (currentSection && !currentOpen) return null
            return (
              <button key={item.id} onClick={() => setNav(item.id!)}
                className={`nav-item${nav === item.id ? ' active' : ''}`}>
                <span className="ni-icon">{ICONS[item.iconKey!]}</span>
                {item.label}
              </button>
            )
          })
        })()}
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        {isLiberty && (
          <div style={{ fontSize: 10, fontWeight: 700, color: '#93C5FD', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>
            ★ Liberty Estate Buyers
          </div>
        )}
        <div className="sidebar-user-name">{user?.name || user?.email}</div>
        <div className="sidebar-user-role">{user?.role?.replace('_', ' ')}</div>
        <button onClick={() => supabase.auth.signOut()} className="btn-outline btn-xs btn-full">Sign Out</button>
      </div>
    </aside>
  )
}
