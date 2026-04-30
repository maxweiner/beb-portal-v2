'use client'

import { useApp } from '@/lib/context'
import Login from '@/components/layout/Login'
import Sidebar from '@/components/layout/Sidebar'
import Dashboard from '@/components/dashboard/Dashboard'
import AdminPanel from '@/components/admin/AdminPanel'
import Events from '@/components/events/Events'
import DayEntry from '@/components/dayentry/DayEntry'
import Stores from '@/components/stores/Stores'
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
import TodoPage from '@/components/todo/TodoPage'
import Calendar from '@/components/calendar/Calendar'
import AppointmentsAdmin from '@/components/appointments-admin/AppointmentsAdmin'
import { RoleGuard } from '@/components/ui/RoleGuard'
import LibertyAdminPanel from '@/components/admin/LibertyAdminPanel'
import NotificationTemplatesAdmin from '@/components/admin/NotificationTemplatesAdmin'
import DataResearch from '@/components/admin/DataResearch'
import { useState, useEffect } from 'react'
import MobileLayout from '@/components/mobile/MobileLayout'
import MobileDashboard from '@/components/mobile/MobileDashboard'
import MobileDayEntry from '@/components/mobile/MobileDayEntry'
import MobileTravel from '@/components/mobile/MobileTravel'
import MobileStaff from '@/components/mobile/MobileStaff'
import BrandSwitchOverlay from '@/components/layout/BrandSwitchOverlay'
import { shouldUseMobile, setMobilePreference } from '@/lib/mobile'

export type NavPage = 'dashboard' | 'calendar' | 'events' | 'schedule' | 'travel' | 'dayentry' | 'staff' | 'admin' | 'stores' | 'marketing' | 'shipping' | 'reports' | 'settings' | 'libertyadmin' | 'recipients' | 'notification-templates' | 'data-research' | 'expenses' | 'financials' | 'todo'

export default function Home() {
  const { user, loading, connectionError, reload } = useApp()
  const [navKey, setNavKey] = useState(0)
  const [nav, rawSetNav] = useState<NavPage>('dashboard')
  const setNav = (n: NavPage) => { rawSetNav(n); setNavKey(k => k + 1) }
  const [isMobile, setIsMobile] = useState(false)

  // Role-scoped nav guards. Marketing = Calendar + Marketing only.
  // Accounting = Calendar + Travel + Staff + Expenses only. Force
  // nav back to an allowed section so deep-links can't bypass the
  // sidebar restriction.
  useEffect(() => {
    if (user?.role === 'marketing' && nav !== 'marketing' && nav !== 'calendar') {
      rawSetNav('marketing')
    }
    if (user?.role === 'accounting'
        && nav !== 'calendar' && nav !== 'travel'
        && nav !== 'staff'    && nav !== 'expenses'
        && nav !== 'settings') {
      rawSetNav('calendar')
    }
  }, [user?.role, nav])

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
        <div className="flex flex-col items-center gap-4">
          <div className="w-9 h-9 border-4 rounded-full animate-spin"
            style={{ borderColor: 'var(--pearl)', borderTopColor: 'var(--green)' }} />
          <div className="text-sm font-semibold" style={{ color: 'var(--mist)' }}>Loading your portal…</div>
        </div>
      </div>
    )
  }

  if (!user) return <Login />

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
          {nav === 'dashboard' && <MobileDashboard key={navKey} setNav={setNav} />}
          {nav === 'dayentry'  && <MobileDayEntry key={navKey} />}
          {nav === 'events'    && <Events key={navKey} setNav={setNav} />}
          {nav === 'calendar'  && <AppointmentsAdmin key={navKey} />}
          {nav === 'schedule'  && <Schedule key={navKey} />}
          {nav === 'travel'    && <MobileTravel key={navKey} />}
          {nav === 'staff'     && <MobileStaff key={navKey} />}
          {nav === 'shipping'  && <Shipping key={navKey} />}
          {nav === 'reports'   && <Reports key={navKey} />}
          {nav === 'expenses'  && <Expenses key={navKey} />}
          {nav === 'financials' && <PartnerFinancials key={navKey} onOpenReport={(id) => {
            setNav('expenses')
            setTimeout(() => window.dispatchEvent(new CustomEvent('beb:open-expense-report', { detail: { reportId: id } })), 0)
          }} />}
          {nav === 'marketing' && <Marketing key={navKey} />}
          {nav === 'todo'      && <TodoPage key={navKey} />}
          {nav === 'settings'  && <Settings key={navKey} />}
          {nav === 'admin'     && <RoleGuard roles={["admin", "superadmin"]}><AdminPanel key={navKey} /></RoleGuard>}
          {nav === 'libertyadmin' && <RoleGuard roles={["admin", "superadmin"]}><LibertyAdminPanel key={navKey} /></RoleGuard>}
          {nav === 'stores'    && <RoleGuard roles={["admin", "superadmin"]}><Stores key={navKey} /></RoleGuard>}
        </MobileLayout>
      </>
    )
  }

  return (
    <>
    <ConnectionBanner />
    <BrandSwitchOverlay />
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--page-bg)' }}>
      {/* Switch to mobile button */}
      <button onClick={() => { setMobilePreference(true); window.location.reload() }}
        style={{ position: 'fixed', bottom: 16, right: 16, zIndex: 50, background: 'var(--sidebar-bg)', color: '#fff', border: 'none', borderRadius: 99, padding: '6px 14px', fontSize: 11, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,.2)', opacity: 0.7 }}>
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
        {nav === 'dashboard'  && <Dashboard key={navKey} setNav={setNav} />}
        {nav === 'calendar'   && <AppointmentsAdmin key={navKey} />}
        {nav === 'events'     && <Events key={navKey} setNav={setNav} />}
        {nav === 'dayentry'   && <DayEntry key={navKey} />}
        {nav === 'shipping'   && <Shipping key={navKey} />}
        {nav === 'reports'    && <Reports key={navKey} />}
        {nav === 'expenses'   && <Expenses key={navKey} />}
        {nav === 'financials' && <PartnerFinancials key={navKey} onOpenReport={(id) => {
          setNav('expenses')
          setTimeout(() => window.dispatchEvent(new CustomEvent('beb:open-expense-report', { detail: { reportId: id } })), 0)
        }} />}
        {nav === 'todo'       && <TodoPage key={navKey} />}
        {nav === 'settings'   && <Settings key={navKey} />}
        {nav === 'staff'      && <Staff key={navKey} />}
        {nav === 'schedule'   && <Schedule key={navKey} />}
        {nav === 'travel'     && <Travel key={navKey} />}
        {nav === 'marketing'  && <Marketing key={navKey} />}
        {nav === 'admin' && (
          <RoleGuard roles={['admin', 'superadmin']}>
            <AdminPanel key={navKey} />
          </RoleGuard>
        )}
        {nav === 'libertyadmin' && (
          <RoleGuard roles={['admin', 'superadmin']}>
            <LibertyAdminPanel key={navKey} />
          </RoleGuard>
        )}
        {nav === 'stores' && (
          <RoleGuard roles={['admin', 'superadmin']}>
            <Stores key={navKey} />
          </RoleGuard>
        )}
        {nav === 'notification-templates' && (
          <RoleGuard roles={['superadmin']}>
            <NotificationTemplatesAdmin key={navKey} />
          </RoleGuard>
        )}
        {nav === 'data-research' && (
          <RoleGuard roles={['admin', 'superadmin']}>
            <DataResearch key={navKey} />
          </RoleGuard>
        )}
      </main>
    </div>
    </>
  )
}
