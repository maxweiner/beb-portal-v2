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
import Marketing from '@/components/marketing/Marketing'
import Historical from '@/components/historical/Historical'
import Calendar from '@/components/calendar/Calendar'
import { RoleGuard } from '@/components/ui/RoleGuard'
import LibertyAdminPanel from '@/components/admin/LibertyAdminPanel'
import { useState, useEffect } from 'react'
import MobileLayout from '@/components/mobile/MobileLayout'
import MobileDashboard from '@/components/mobile/MobileDashboard'
import MobileDayEntry from '@/components/mobile/MobileDayEntry'
import MobileTravel from '@/components/mobile/MobileTravel'
import { shouldUseMobile, setMobilePreference } from '@/lib/mobile'

export type NavPage = 'dashboard' | 'calendar' | 'events' | 'schedule' | 'travel' | 'dayentry' | 'staff' | 'admin' | 'stores' | 'historical' | 'marketing' | 'shipping' | 'reports' | 'settings' | 'libertyadmin'

export default function Home() {
  const { user, loading } = useApp()
  const [navKey, setNavKey] = useState(0)
  const [nav, rawSetNav] = useState<NavPage>('dashboard')
  const setNav = (n: NavPage) => { rawSetNav(n); setNavKey(k => k + 1) }
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    setIsMobile(shouldUseMobile())
  }, [])

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
      <MobileLayout nav={nav} setNav={setNav}>
        {nav === 'dashboard' && <MobileDashboard />}
        {nav === 'dayentry'  && <MobileDayEntry />}
        {nav === 'events'    && <Events />}
        {nav === 'calendar'  && <Calendar key={navKey} />}
        {nav === 'schedule'  && <Schedule />}
        {nav === 'travel'    && <MobileTravel />}
        {nav === 'staff'     && <Staff />}
        {nav === 'shipping'  && <Shipping />}
        {nav === 'reports'   && <Reports />}
        {nav === 'marketing' && <Marketing />}
        {nav === 'settings'  && <Settings />}
        {nav === 'admin'     && <RoleGuard roles={["admin", "superadmin"]}><AdminPanel /></RoleGuard>}
        {nav === 'libertyadmin' && <RoleGuard roles={["admin", "superadmin"]}><LibertyAdminPanel /></RoleGuard>}
        {nav === 'stores'    && <RoleGuard roles={["admin", "superadmin"]}><Stores /></RoleGuard>}
        {nav === 'historical'&& <RoleGuard roles={["admin", "superadmin"]}><Historical /></RoleGuard>}
      </MobileLayout>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--page-bg)' }}>
      {/* Switch to mobile button */}
      <button onClick={() => { setMobilePreference(true); window.location.reload() }}
        style={{ position: 'fixed', bottom: 16, right: 16, zIndex: 50, background: 'var(--sidebar-bg)', color: '#fff', border: 'none', borderRadius: 99, padding: '6px 14px', fontSize: 11, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,.2)', opacity: 0.7 }}>
        📱 Mobile
      </button>
      <Sidebar nav={nav} setNav={setNav} />
      <main className="flex-1 overflow-y-auto">
        {nav === 'dashboard'  && <Dashboard />}
        {nav === 'calendar'   && <Calendar key={navKey} />}
        {nav === 'events'     && <Events />}
        {nav === 'dayentry'   && <DayEntry />}
        {nav === 'shipping'   && <Shipping />}
        {nav === 'reports'    && <Reports />}
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
        {nav === 'historical' && (
          <RoleGuard roles={['admin', 'superadmin']}>
            <Historical />
          </RoleGuard>
        )}
      </main>
    </div>
  )
}
