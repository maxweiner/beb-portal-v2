'use client'

import { useApp } from '@/lib/context'
import Login from '@/components/layout/Login'
import PendingApprovalScreen from '@/components/layout/PendingApprovalScreen'
import PhonePromptScreen from '@/components/layout/PhonePromptScreen'
import Sidebar from '@/components/layout/Sidebar'
import Dashboard from '@/components/dashboard/Dashboard'
import AdminPanel from '@/components/admin/AdminPanel'
import BuyingEventsView from '@/components/events/BuyingEventsView'
import DayEntry from '@/components/dayentry/DayEntry'
import Stores from '@/components/stores/Stores'
import TrunkShowStores from '@/components/stores/TrunkShowStores'
import Customers from '@/components/customers/Customers'
import Shipping from '@/components/shipping/Shipping'
import Reports from '@/components/reports/Reports'
import Settings from '@/components/settings/Settings'
import Staff from '@/components/staff/Staff'
import Schedule from '@/components/schedule/Schedule'
import Travel from '@/components/travel/Travel'
import Expenses from '@/components/expenses/Expenses'
import PendingApprovalsModal from '@/components/expenses/PendingApprovalsModal'
import PartnerFinancials from '@/components/financials/PartnerFinancials'
import Marketing from '@/components/marketing/Marketing'
import Calendar from '@/components/calendar/Calendar'
import AppointmentsAdmin from '@/components/appointments-admin/AppointmentsAdmin'
import { ModuleGuard } from '@/components/ui/ModuleGuard'
import ModuleWriteGate from '@/components/ui/ModuleWriteGate'
import { useRoleModules } from '@/lib/useRoleModules'
import LibertyAdminPanel from '@/components/admin/LibertyAdminPanel'
import NotificationTemplatesAdmin from '@/components/admin/NotificationTemplatesAdmin'
import DataResearch from '@/components/admin/DataResearch'
import SalesRepDashboard from '@/components/sales/SalesRepDashboard'
import TradeShows from '@/components/sales/TradeShows'
import TrunkShows from '@/components/sales/TrunkShows'
import Leads from '@/components/sales/Leads'
import TrunkCommunications from '@/components/communications/TrunkCommunications'
import { useState, useEffect, useRef } from 'react'
import MobileLayout from '@/components/mobile/MobileLayout'
import MobileDashboard from '@/components/mobile/MobileDashboard'
import MobileDayEntry from '@/components/mobile/MobileDayEntry'
import MobileTravel from '@/components/mobile/MobileTravel'
import AccountingQueue from '@/components/accounting/AccountingQueue'
import MobileStaff from '@/components/mobile/MobileStaff'
import BrandSwitchOverlay from '@/components/layout/BrandSwitchOverlay'
import { shouldUseMobile, setMobilePreference } from '@/lib/mobile'

// Nav ids — keep in sync with the role_modules.module_id CHECK constraint
// (see supabase-migration-rename-nav-ids.sql). Renamed 2026-05-06:
//   calendar     → appointments     (buyer appointment schedule page)
//   schedule     → calendar         (time-off + event calendar)
//   events       → buying-events
//   libertyadmin → liberty-admin
export type NavPage = 'dashboard' | 'appointments' | 'buying-events' | 'calendar' | 'travel' | 'dayentry' | 'staff' | 'admin' | 'buying-event-stores' | 'marketing' | 'shipping' | 'reports' | 'settings' | 'liberty-admin' | 'recipients' | 'notification-templates' | 'data-research' | 'expenses' | 'financials' | 'customers' | 'trade-shows' | 'trunk-shows' | 'trunk-show-stores' | 'leads' | 'trunk-communications' | 'accounting-queue'

export default function Home() {
  const { user, loading, connectionError, reload } = useApp()
  const [navKey, setNavKey] = useState(0)
  const [nav, rawSetNav] = useState<NavPage>('dashboard')
  const setNav = (n: NavPage) => { rawSetNav(n); setNavKey(k => k + 1) }
  const [isMobile, setIsMobile] = useState(false)
  const initialRoutedRef = useRef(false)

  // Initial landing: every user starts on dashboard. If their role
  // doesn't grant dashboard, fall through to the first granted page
  // from the fallback list. ABSOLUTE final fallback is also dashboard
  // (NOT settings) so even an empty role_modules read (RLS hiccup,
  // stale session) lands users somewhere expected — Dashboard knows
  // how to render an empty state. Runs once after user + modules load,
  // tracked via useRef so it doesn't fight subsequent nav clicks.
  // Skipped when an email deep-link (?report=…) is present.
  const { modules: grantedModules, loaded: modulesLoaded } = useRoleModules()
  const FALLBACK_ORDER: NavPage[] = [
    'dashboard', 'appointments', 'marketing', 'expenses',
    'buying-events', 'calendar', 'travel', 'staff', 'shipping',
    'reports',
  ]
  useEffect(() => {
    if (!user || !modulesLoaded || initialRoutedRef.current) return
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('report')) {
      initialRoutedRef.current = true
      return
    }
    initialRoutedRef.current = true
    const next = FALLBACK_ORDER.find(p => grantedModules.has(p)) ?? 'dashboard'
    rawSetNav(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, modulesLoaded, grantedModules])

  // Generic deep-link guard: if the current nav target isn't in the
  // user's role_modules, redirect. Dashboard is the final fallback
  // (not settings) so a role_modules read failure doesn't dump users
  // into the gear-icon page. Settings stays reachable via the gear.
  useEffect(() => {
    if (!modulesLoaded || !user) return
    if (nav === 'settings') return  // respect manual gear-icon clicks
    if (grantedModules.has(nav)) return
    const next = FALLBACK_ORDER.find(p => grantedModules.has(p)) ?? 'dashboard'
    rawSetNav(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modulesLoaded, grantedModules, nav, user])

  useEffect(() => {
    setIsMobile(shouldUseMobile())
  }, [])

  // When the brand switch commits in context, jump back to dashboard. Listening
  // for the event (instead of putting setNav inside the Sidebar handler) keeps
  // the brand commit and the nav reset in the same render — no flash of the
  // new brand on the previous page.
  useEffect(() => {
    const onSwitched = () => rawSetNav('dashboard')
    window.addEventListener('beb:brand-switched', onSwitched)
    return () => window.removeEventListener('beb:brand-switched', onSwitched)
  }, [])

  // Deep-link from email: `?report=<id>` opens the Expenses tab and asks
  // it to surface that report. Strips the param so a refresh doesn't keep
  // re-opening it. Applied once `user` is available so the auth gate
  // doesn't swallow the link.
  useEffect(() => {
    if (!user) return
    const params = new URLSearchParams(window.location.search)
    const reportId = params.get('report')
    if (reportId) {
      rawSetNav('expenses')
      // Defer so Expenses is mounted before we ask it to open a report.
      setTimeout(() => window.dispatchEvent(
        new CustomEvent('beb:open-expense-report', { detail: { reportId } }),
      ), 0)
    }
    if (params.has('report')) {
      const url = new URL(window.location.href)
      url.searchParams.delete('report')
      window.history.replaceState({}, '', url.toString())
    }
  }, [user])

  const ConnectionBanner = () => connectionError ? (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      background: '#DC2626', color: 'white', padding: '10px 16px',
      display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12,
      fontSize: 14, fontWeight: 700,
    }}>
      <span>Connection error — data may be incomplete</span>
      <button onClick={() => reload()} style={{
        background: 'white', color: '#DC2626', border: 'none', borderRadius: 6,
        padding: '4px 12px', fontWeight: 700, cursor: 'pointer', fontSize: 13,
      }}>Retry</button>
    </div>
  ) : null

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: 'var(--page-bg)' }}>
        <div className="flex flex-col items-center gap-5">
          <div style={{ display: 'flex', gap: 18 }} aria-label="Loading">
            <span className="beb-jewel-loader" style={{ animationDelay: '0s, 0s' }}>💎</span>
            <span className="beb-jewel-loader" style={{ animationDelay: '.18s, .4s' }}>💍</span>
            <span className="beb-jewel-loader" style={{ animationDelay: '.36s, .8s' }}>⌚</span>
            <span className="beb-jewel-loader" style={{ animationDelay: '.54s, 1.2s' }}>👑</span>
          </div>
          <div className="text-sm font-semibold" style={{ color: 'var(--mist)' }}>Loading your portal…</div>
        </div>
      </div>
    )
  }

  if (!user) return <Login />
  if (user.role === 'pending') return <PendingApprovalScreen user={user} />
  // Capture missing phone numbers after sign-in. Pending users skip this
  // since they can't reach anywhere meaningful in the app yet.
  if (!user.phone || user.phone.trim() === '') return <PhonePromptScreen user={user} />

  // Mobile layout
  if (isMobile) {
    return (
      <>
        <ConnectionBanner />
        <BrandSwitchOverlay />
        <PendingApprovalsModal onOpen={(id) => {
          setNav('expenses')
          setTimeout(() => window.dispatchEvent(new CustomEvent('beb:open-expense-report', { detail: { reportId: id } })), 0)
        }} />
        <MobileLayout nav={nav} setNav={setNav}>
          {/* `key={navKey}` on every section forces a fresh remount when
              the user clicks any sidebar nav link — internal state (open
              detail views, filters, search, expanded cards, etc.) resets
              to the section's landing page. setNav() bumps navKey on
              every click; rawSetNav() (used by deep-link / brand-switch
              handlers) does not, preserving those flows. */}
          {nav === 'dashboard' && <ModuleWriteGate moduleId="dashboard">{user?.role === 'sales_rep'
            ? <SalesRepDashboard key={navKey} setNav={setNav} />
            : <MobileDashboard key={navKey} setNav={setNav} />}</ModuleWriteGate>}
          {nav === 'trade-shows' && <ModuleWriteGate moduleId="trade-shows"><TradeShows key={navKey} /></ModuleWriteGate>}
          {nav === 'trunk-shows' && <ModuleWriteGate moduleId="trunk-shows"><TrunkShows key={navKey} setNav={setNav} /></ModuleWriteGate>}
          {nav === 'trunk-communications' && <TrunkCommunications key={navKey} />}
          {nav === 'leads'       && <ModuleWriteGate moduleId="leads"><Leads key={navKey} setNav={setNav} /></ModuleWriteGate>}
          {nav === 'dayentry'  && <ModuleWriteGate moduleId="dayentry"><MobileDayEntry key={navKey} /></ModuleWriteGate>}
          {nav === 'buying-events' && <ModuleWriteGate moduleId="buying-events"><BuyingEventsView key={navKey} setNav={setNav} /></ModuleWriteGate>}
          {nav === 'appointments'  && <ModuleWriteGate moduleId="appointments"><AppointmentsAdmin key={navKey} /></ModuleWriteGate>}
          {nav === 'calendar'  && <ModuleWriteGate moduleId="calendar"><Schedule key={navKey} setNav={setNav} /></ModuleWriteGate>}
          {nav === 'travel'    && <ModuleWriteGate moduleId="travel"><MobileTravel key={navKey} /></ModuleWriteGate>}
          {nav === 'staff'     && <ModuleWriteGate moduleId="staff"><MobileStaff key={navKey} /></ModuleWriteGate>}
          {nav === 'shipping'  && <ModuleWriteGate moduleId="shipping"><Shipping key={navKey} /></ModuleWriteGate>}
          {nav === 'reports'   && <ModuleWriteGate moduleId="reports"><Reports key={navKey} /></ModuleWriteGate>}
          {nav === 'expenses'  && <ModuleWriteGate moduleId="expenses"><Expenses key={navKey} /></ModuleWriteGate>}
          {nav === 'financials' && <ModuleWriteGate moduleId="financials"><PartnerFinancials key={navKey} onOpenReport={(id) => {
            setNav('expenses')
            setTimeout(() => window.dispatchEvent(new CustomEvent('beb:open-expense-report', { detail: { reportId: id } })), 0)
          }} /></ModuleWriteGate>}
          {nav === 'marketing' && <ModuleWriteGate moduleId="marketing"><Marketing key={navKey} /></ModuleWriteGate>}
          {nav === 'settings'  && <Settings key={navKey} />}
          {nav === 'admin'     && <ModuleGuard moduleId="admin"><ModuleWriteGate moduleId="admin"><AdminPanel key={navKey} /></ModuleWriteGate></ModuleGuard>}
          {nav === 'liberty-admin' && <ModuleGuard moduleId="liberty-admin"><ModuleWriteGate moduleId="liberty-admin"><LibertyAdminPanel key={navKey} /></ModuleWriteGate></ModuleGuard>}
          {nav === 'buying-event-stores' && <ModuleGuard moduleId="buying-event-stores"><ModuleWriteGate moduleId="buying-event-stores"><Stores key={navKey} /></ModuleWriteGate></ModuleGuard>}
          {nav === 'trunk-show-stores' && <ModuleGuard moduleId="trunk-show-stores"><ModuleWriteGate moduleId="trunk-show-stores"><TrunkShowStores key={navKey} /></ModuleWriteGate></ModuleGuard>}
          {nav === 'customers' && <ModuleGuard moduleId="customers"><ModuleWriteGate moduleId="customers"><Customers key={navKey} /></ModuleWriteGate></ModuleGuard>}
        </MobileLayout>
      </>
    )
  }

  return (
    <>
    <ConnectionBanner />
    <BrandSwitchOverlay />
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--page-bg)' }}>
      {/* Switch to mobile button. */}
      <button onClick={() => { setMobilePreference(true); window.location.reload() }}
        style={{ position: 'fixed', bottom: 22, right: 16, zIndex: 50, background: 'var(--sidebar-bg)', color: '#fff', border: 'none', borderRadius: 99, padding: '6px 14px', fontSize: 11, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,.2)', opacity: 0.7 }}>
        📱 Mobile
      </button>
      <Sidebar nav={nav} setNav={setNav} />
      <PendingApprovalsModal onOpen={(id) => {
        setNav('expenses')
        // Defer so Expenses is mounted before we ask it to open a report.
        setTimeout(() => window.dispatchEvent(new CustomEvent('beb:open-expense-report', { detail: { reportId: id } })), 0)
      }} />
      <main className="flex-1 overflow-y-auto">
        {/* `key={navKey}` on every section forces a fresh remount when
            the user clicks any sidebar nav link — internal state (open
            detail views, filters, search, expanded cards, etc.) resets
            to the section's landing page. setNav() bumps navKey on
            every click; rawSetNav() (used by deep-link / brand-switch
            handlers) does not, preserving those flows. */}
        {nav === 'dashboard'  && <ModuleWriteGate moduleId="dashboard">{user?.role === 'sales_rep'
          ? <SalesRepDashboard key={navKey} setNav={setNav} />
          : <Dashboard key={navKey} setNav={setNav} />}</ModuleWriteGate>}
        {nav === 'trade-shows' && <ModuleWriteGate moduleId="trade-shows"><TradeShows key={navKey} /></ModuleWriteGate>}
        {nav === 'trunk-shows' && <ModuleWriteGate moduleId="trunk-shows"><TrunkShows key={navKey} setNav={setNav} /></ModuleWriteGate>}
        {nav === 'trunk-communications' && <TrunkCommunications key={navKey} />}
        {nav === 'leads'       && <ModuleWriteGate moduleId="leads"><Leads key={navKey} setNav={setNav} /></ModuleWriteGate>}
        {nav === 'appointments'  && <ModuleWriteGate moduleId="appointments"><AppointmentsAdmin key={navKey} /></ModuleWriteGate>}
        {nav === 'buying-events' && <ModuleWriteGate moduleId="buying-events"><BuyingEventsView key={navKey} setNav={setNav} /></ModuleWriteGate>}
        {nav === 'dayentry'   && <ModuleWriteGate moduleId="dayentry"><DayEntry key={navKey} /></ModuleWriteGate>}
        {nav === 'shipping'   && <ModuleWriteGate moduleId="shipping"><Shipping key={navKey} /></ModuleWriteGate>}
        {nav === 'reports'    && <ModuleWriteGate moduleId="reports"><Reports key={navKey} /></ModuleWriteGate>}
        {nav === 'expenses'   && <ModuleWriteGate moduleId="expenses"><Expenses key={navKey} /></ModuleWriteGate>}
        {nav === 'financials' && <ModuleWriteGate moduleId="financials"><PartnerFinancials key={navKey} onOpenReport={(id) => {
          setNav('expenses')
          setTimeout(() => window.dispatchEvent(new CustomEvent('beb:open-expense-report', { detail: { reportId: id } })), 0)
        }} /></ModuleWriteGate>}
        {nav === 'settings'   && <Settings key={navKey} />}
        {nav === 'staff'      && <ModuleWriteGate moduleId="staff"><Staff key={navKey} /></ModuleWriteGate>}
        {nav === 'calendar'   && <ModuleWriteGate moduleId="calendar"><Schedule key={navKey} setNav={setNav} /></ModuleWriteGate>}
        {nav === 'travel'     && <ModuleWriteGate moduleId="travel"><Travel key={navKey} /></ModuleWriteGate>}
        {nav === 'marketing'  && <ModuleWriteGate moduleId="marketing"><Marketing key={navKey} /></ModuleWriteGate>}
        {nav === 'accounting-queue' && <ModuleGuard moduleId="accounting-queue"><ModuleWriteGate moduleId="accounting-queue"><AccountingQueue key={navKey} setNav={setNav} /></ModuleWriteGate></ModuleGuard>}
        {nav === 'admin' && (
          <ModuleGuard moduleId="admin">
            <ModuleWriteGate moduleId="admin">
              <AdminPanel key={navKey} />
            </ModuleWriteGate>
          </ModuleGuard>
        )}
        {nav === 'liberty-admin' && (
          <ModuleGuard moduleId="liberty-admin">
            <ModuleWriteGate moduleId="liberty-admin">
              <LibertyAdminPanel key={navKey} />
            </ModuleWriteGate>
          </ModuleGuard>
        )}
        {nav === 'buying-event-stores' && (
          <ModuleGuard moduleId="buying-event-stores">
            <ModuleWriteGate moduleId="buying-event-stores">
              <Stores key={navKey} />
            </ModuleWriteGate>
          </ModuleGuard>
        )}
        {nav === 'trunk-show-stores' && (
          <ModuleGuard moduleId="trunk-show-stores">
            <ModuleWriteGate moduleId="trunk-show-stores">
              <TrunkShowStores key={navKey} />
            </ModuleWriteGate>
          </ModuleGuard>
        )}
        {nav === 'customers' && (
          <ModuleGuard moduleId="customers">
            <ModuleWriteGate moduleId="customers">
              <Customers key={navKey} />
            </ModuleWriteGate>
          </ModuleGuard>
        )}
        {nav === 'notification-templates' && (
          <ModuleGuard moduleId="notification-templates">
            <ModuleWriteGate moduleId="notification-templates">
              <NotificationTemplatesAdmin key={navKey} />
            </ModuleWriteGate>
          </ModuleGuard>
        )}
        {nav === 'data-research' && (
          <ModuleGuard moduleId="data-research">
            <ModuleWriteGate moduleId="data-research">
              <DataResearch key={navKey} />
            </ModuleWriteGate>
          </ModuleGuard>
        )}
      </main>
    </div>
    </>
  )
}
