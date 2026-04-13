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
import Historical from '@/components/historical/Historical'
import Calendar from '@/components/calendar/Calendar'
import { RoleGuard } from '@/components/ui/RoleGuard'
import { useState } from 'react'

export type NavPage = 'dashboard' | 'calendar' | 'events' | 'dayentry' | 'admin' | 'stores' | 'historical' | 'shipping' | 'reports' | 'settings'

export default function Home() {
  const { user, loading } = useApp()
  const [nav, setNav] = useState<NavPage>('dashboard')

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

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--page-bg)' }}>
      <Sidebar nav={nav} setNav={setNav} />
      <main className="flex-1 overflow-y-auto">
        {nav === 'dashboard'  && <Dashboard />}
        {nav === 'calendar'   && <Calendar />}
        {nav === 'events'     && <Events />}
        {nav === 'dayentry'   && <DayEntry />}
        {nav === 'shipping'   && <Shipping />}
        {nav === 'reports'    && <Reports />}
        {nav === 'settings'   && <Settings />}
        {nav === 'admin' && (
          <RoleGuard roles={['admin', 'superadmin']}>
            <AdminPanel />
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
