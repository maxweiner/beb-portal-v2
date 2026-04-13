'use client'

import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type { NavPage } from '@/app/page'

const ICONS: Record<string, JSX.Element> = {
  dashboard: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="6" height="6" rx="1" fill="currentColor" opacity=".9"/><rect x="9" y="1" width="6" height="6" rx="1" fill="currentColor" opacity=".9"/><rect x="1" y="9" width="6" height="6" rx="1" fill="currentColor" opacity=".9"/><rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" opacity=".9"/></svg>,
  calendar:  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="3" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M1 7h14" stroke="currentColor" strokeWidth="1.5"/><path d="M5 1v4M11 1v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  events:    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5"/><circle cx="8" cy="8" r="2.5" fill="currentColor"/></svg>,
  dayentry:  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M3 4h6M3 12h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  admin:     <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="6" cy="5" r="3" stroke="currentColor" strokeWidth="1.5"/><path d="M1 14c0-3 2-5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M11 9l1.5 1.5L15 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5"/></svg>,
  stores:    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 6.5L8 2l6 4.5V14a1 1 0 01-1 1H3a1 1 0 01-1-1V6.5z" stroke="currentColor" strokeWidth="1.5"/><path d="M6 15V9h4v6" stroke="currentColor" strokeWidth="1.5"/></svg>,
  historical:<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5"/><path d="M8 5v3l2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  shipping:  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="4" width="10" height="8" rx="1" stroke="currentColor" strokeWidth="1.5"/><path d="M11 6h2l2 3v3h-4V6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><circle cx="4" cy="13" r="1.5" fill="currentColor"/><circle cx="12" cy="13" r="1.5" fill="currentColor"/></svg>,
  reports:   <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><path d="M5 10V8M8 10V6M11 10V4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  settings:  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
}

interface NavItem {
  id?: NavPage
  label: string
  iconKey?: string
  section?: boolean
  adminOnly?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard',  label: 'Dashboard',      iconKey: 'dashboard' },
  { id: 'calendar',   label: 'Calendar',        iconKey: 'calendar' },
  { id: 'events',     label: 'Events',          iconKey: 'events' },
  { id: 'dayentry',   label: 'Enter Day Data',  iconKey: 'dayentry' },
  { label: 'Admin', section: true },
  { id: 'admin',      label: 'Admin Panel',     iconKey: 'admin',     adminOnly: true },
  { id: 'stores',     label: 'Stores',          iconKey: 'stores',    adminOnly: true },
  { id: 'historical', label: 'Historical Data', iconKey: 'historical',adminOnly: true },
  { label: 'Tools', section: true },
  { id: 'shipping',   label: 'Shipping',        iconKey: 'shipping' },
  { id: 'reports',    label: 'Reports',         iconKey: 'reports' },
  { id: 'settings',   label: 'Settings',        iconKey: 'settings' },
]

interface SidebarProps {
  nav: NavPage
  setNav: (n: NavPage) => void
}

export default function Sidebar({ nav, setNav }: SidebarProps) {
  const { user } = useApp()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'non_buyer_admin'

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-row">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="#7EC8A0"><path d="M7 0l2.5 4.5H14L10.5 7 12 12 7 9 2 12l1.5-5L0 4.5h4.5L7 0z"/></svg>
          <span className="app-name">BeneficialOS</span>
        </div>
        <span className="app-sub">Buyer Portal</span>
      </div>

      {/* Nav */}
      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item, i) => {
          if (item.section) return (
            <div key={i} className="nav-group-label">{item.label}</div>
          )
          if (item.adminOnly && !isAdmin) return null
          return (
            <button key={item.id} onClick={() => setNav(item.id!)}
              className={`nav-item${nav === item.id ? ' active' : ''}`}>
              <span className="ni-icon">{ICONS[item.iconKey!]}</span>
              {item.label}
            </button>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        <div className="sidebar-user-name">{user?.name || user?.email}</div>
        <div className="sidebar-user-role">{user?.role?.replace('_', ' ')}</div>
        <button onClick={() => supabase.auth.signOut()} className="btn-outline btn-xs btn-full">
          Sign Out
        </button>
      </div>
    </aside>
  )
}
