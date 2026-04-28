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
import Marketing from '@/components/marketing/Marketing'
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

export type NavPage = 'dashboard' | 'calendar' | 'events' | 'schedule' | 'travel' | 'dayentry' | 'staff' | 'admin' | 'stores' | 'marketing' | 'shipping' | 'reports' | 'settings' | 'libertyadmin' | 'recipients' | 'notification-templates' | 'data-research' | 'expenses'

export default function Home() {
  const { user, loading, connectionError, reload } = useApp()
  const [navKey, setNavKey] = useState(0)
  const [nav, rawSetNav] = useState<NavPage>('dashboard')
  const setNav = (n: NavPage) => { rawSetNav(n); setNavKey(k => k + 1) }
  const [isMobile, setIsMobile] = useState(false)

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
          {nav === 'dashboard' && <MobileDashboard setNav={setNav} />}
          {nav === 'dayentry'  && <MobileDayEntry />}
          {nav === 'events'    && <Events setNav={setNav} />}
          {nav === 'calendar'  && <AppointmentsAdmin key={navKey} />}
          {nav === 'schedule'  && <Schedule />}
          {nav === 'travel'    && <MobileTravel />}
          {nav === 'staff'     && <MobileStaff />}
          {nav === 'shipping'  && <Shipping />}
          {nav === 'reports'   && <Reports />}
          {nav === 'expenses'  && <Expenses />}
          {nav === 'marketing' && <Marketing />}
          {nav === 'settings'  && <Settings />}
          {nav === 'admin'     && <RoleGuard roles={["admin", "superadmin"]}><AdminPanel /></RoleGuard>}
          {nav === 'libertyadmin' && <RoleGuard roles={["admin", "superadmin"]}><LibertyAdminPanel /></RoleGuard>}
          {nav === 'stores'    && <RoleGuard roles={["admin", "superadmin"]}><Stores /></RoleGuard>}
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
        {nav === 'dashboard'  && <Dashboard setNav={setNav} />}
        {nav === 'calendar'   && <AppointmentsAdmin key={navKey} />}
        {nav === 'events'     && <Events setNav={setNav} />}
        {nav === 'dayentry'   && <DayEntry />}
        {nav === 'shipping'   && <Shipping />}
        {nav === 'reports'    && <Reports />}
        {nav === 'expenses'   && <Expenses />}
        {nav === 'settings'   && <Settings />}
        {nav === 'staff'      && <Staff />}
        {nav === 'schedule'   && <Schedule />}
        {nav === 'travel'     && <Travel />}
        {nav === 'marketing'  && <Marketing />}
        {nav === 'admin' && (
          <RoleGuard roles={['admin', 'superadmin']}>
            <AdminPanel />
          </RoleGuard>
        )}
        {nav === 'libertyadmin' && (
          <RoleGuard roles={['admin', 'superadmin']}>
            <LibertyAdminPanel />
          </RoleGuard>
        )}
        {nav === 'stores' && (
          <RoleGuard roles={['admin', 'superadmin']}>
            <Stores />
          </RoleGuard>
        )}
        {nav === 'notification-templates' && (
          <RoleGuard roles={['superadmin']}>
            <NotificationTemplatesAdmin />
          </RoleGuard>
        )}
        {nav === 'data-research' && (
          <RoleGuard roles={['admin', 'superadmin']}>
            <DataResearch />
          </RoleGuard>
        )}
      </main>
    </div>
    </>
  )
}
