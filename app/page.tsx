'use client'

// Eager imports: layout chrome + landing-screen components. These
// render on every load (login, splash, dashboard, sidebar) so there's
// no benefit to code-splitting them — they'd just add an extra round
// trip on first paint. Everything else is dynamic() below so it
// downloads only when the user navigates to that nav target.
import { useApp } from '@/lib/context'
import Login from '@/components/layout/Login'
import PendingApprovalScreen from '@/components/layout/PendingApprovalScreen'
import PhonePromptScreen from '@/components/layout/PhonePromptScreen'
import Sidebar from '@/components/layout/Sidebar'
import Dashboard from '@/components/dashboard/Dashboard'
import { ModuleGuard } from '@/components/ui/ModuleGuard'
import ModuleWriteGate from '@/components/ui/ModuleWriteGate'
import { useRoleModules } from '@/lib/useRoleModules'
import { useState, useEffect, useRef } from 'react'
import MobileLayout from '@/components/mobile/MobileLayout'
import MobileDashboard from '@/components/mobile/MobileDashboard'
import BroadcastBanner from '@/components/broadcast/BroadcastBanner'
import BrandSwitchOverlay from '@/components/layout/BrandSwitchOverlay'
import LoadingSpinner from '@/components/layout/LoadingSpinner'
import PendingApprovalsModal from '@/components/expenses/PendingApprovalsModal'
import PendingW9Modal from '@/components/w9/PendingW9Modal'
import { shouldUseMobile, setMobilePreference } from '@/lib/mobile'
import dynamic from 'next/dynamic'

// Code-split: each nav-target module is its own JS chunk that only
// downloads when the user first navigates there. Cuts the route's
// initial JS bundle from ~511 kB to ~120 kB. ssr:false is correct here
// — every consumer is a client component and SSR is already off for
// app/page.tsx (which is 'use client'). loading:() => null is the
// friendliest placeholder; the user clicked a sidebar link and the
// content area momentarily blanks before the new module mounts.
const AdminPanel = dynamic(() => import('@/components/admin/AdminPanel'), { ssr: false })
const BuyingEventsView = dynamic(() => import('@/components/events/BuyingEventsView'), { ssr: false })
const DayEntry = dynamic(() => import('@/components/dayentry/DayEntry'), { ssr: false })
const Stores = dynamic(() => import('@/components/stores/Stores'), { ssr: false })
const TrunkShowStores = dynamic(() => import('@/components/stores/TrunkShowStores'), { ssr: false })
const Customers = dynamic(() => import('@/components/customers/Customers'), { ssr: false })
const Shipping = dynamic(() => import('@/components/shipping/Shipping'), { ssr: false })
const Reports = dynamic(() => import('@/components/reports/Reports'), { ssr: false })
const Settings = dynamic(() => import('@/components/settings/Settings'), { ssr: false })
const Staff = dynamic(() => import('@/components/staff/Staff'), { ssr: false })
const Schedule = dynamic(() => import('@/components/schedule/Schedule'), { ssr: false })
const Travel = dynamic(() => import('@/components/travel/Travel'), { ssr: false })
const Expenses = dynamic(() => import('@/components/expenses/Expenses'), { ssr: false })
const PartnerFinancials = dynamic(() => import('@/components/financials/PartnerFinancials'), { ssr: false })
const Marketing = dynamic(() => import('@/components/marketing/Marketing'), { ssr: false })
const AppointmentsAdmin = dynamic(() => import('@/components/appointments-admin/AppointmentsAdmin'), { ssr: false })
const IntakeLookup = dynamic(() => import('@/components/intake/IntakeLookup'), { ssr: false })
const IntakePage = dynamic(() => import('@/components/intake/IntakePage'), { ssr: false })
const LibertyAdminPanel = dynamic(() => import('@/components/admin/LibertyAdminPanel'), { ssr: false })
const NotificationTemplatesAdmin = dynamic(() => import('@/components/admin/NotificationTemplatesAdmin'), { ssr: false })
const DataResearch = dynamic(() => import('@/components/admin/DataResearch'), { ssr: false })
const SalesRepDashboard = dynamic(() => import('@/components/sales/SalesRepDashboard'), { ssr: false })
const TradeShows = dynamic(() => import('@/components/sales/TradeShows'), { ssr: false })
const TrunkShows = dynamic(() => import('@/components/sales/TrunkShows'), { ssr: false })
const Leads = dynamic(() => import('@/components/sales/Leads'), { ssr: false })
const TrunkCommunications = dynamic(() => import('@/components/communications/TrunkCommunications'), { ssr: false })
const BuyingCommunications = dynamic(() => import('@/components/communications/BuyingCommunications'), { ssr: false })
const MobileDayEntry = dynamic(() => import('@/components/mobile/MobileDayEntry'), { ssr: false })
const MobileTravel = dynamic(() => import('@/components/mobile/MobileTravel'), { ssr: false })
const AccountingHub = dynamic(() => import('@/components/accounting/AccountingHub'), { ssr: false })
const ReconciliationPage = dynamic(() => import('@/components/reconciliation/ReconciliationPage'), { ssr: false })
const WholesalePage = dynamic(() => import('@/components/wholesale/WholesalePage'), { ssr: false })
const BroadcastPage = dynamic(() => import('@/components/broadcast/BroadcastPage'), { ssr: false })
const MobileStaff = dynamic(() => import('@/components/mobile/MobileStaff'), { ssr: false })

// Nav ids — keep in sync with the role_modules.module_id CHECK constraint
// (see supabase-migration-rename-nav-ids.sql). Renamed 2026-05-06:
//   calendar     → appointments     (buyer appointment schedule page)
//   schedule     → calendar         (time-off + event calendar)
//   events       → buying-events
//   libertyadmin → liberty-admin
export type NavPage = 'dashboard' | 'appointments' | 'buying-events' | 'calendar' | 'travel' | 'dayentry' | 'staff' | 'admin' | 'buying-event-stores' | 'marketing' | 'shipping' | 'reports' | 'settings' | 'liberty-admin' | 'recipients' | 'notification-templates' | 'data-research' | 'expenses' | 'financials' | 'customers' | 'trade-shows' | 'trunk-shows' | 'trunk-show-stores' | 'leads' | 'trunk-communications' | 'buying-communications' | 'accounting-hub' | 'broadcast' | 'intake-lookup' | 'buy-intake' | 'reconciliation' | 'wholesale'

// Allow-list for the ?nav= URL deep-link. Mirrors the NavPage type
// at runtime so we can validate URL params before routing. Keep in
// sync with the NavPage union above — TypeScript can't reflect a
// string-literal union to a Set at runtime.
const KNOWN_NAVS = new Set<NavPage>([
  'dashboard', 'appointments', 'buying-events', 'calendar', 'travel',
  'dayentry', 'staff', 'admin', 'buying-event-stores', 'marketing',
  'shipping', 'reports', 'settings', 'liberty-admin', 'recipients',
  'notification-templates', 'data-research', 'expenses', 'financials',
  'customers', 'trade-shows', 'trunk-shows', 'trunk-show-stores',
  'leads', 'trunk-communications', 'buying-communications', 'accounting-hub', 'broadcast',
  'intake-lookup', 'buy-intake', 'reconciliation', 'wholesale',
])

export default function Home() {
  const { user, loading, connectionError, reload } = useApp()
  const [navKey, setNavKey] = useState(0)
  const [nav, rawSetNav] = useState<NavPage>('dashboard')
  const setNav = (n: NavPage) => { rawSetNav(n); setNavKey(k => k + 1) }
  const [isMobile, setIsMobile] = useState(false)
  // Records the user.id we performed the one-time initial route for.
  // Comparing against the current user.id lets sign-out / sign-back-in
  // re-run the routing logic without the ref staying stuck on the old
  // user. Was a `useRef<boolean>` until 2026-05-17 — flipped to a
  // user-keyed ref so the lock can't survive a session change.
  const routedForUserIdRef = useRef<string | null>(null)

  // Initial landing: every user starts on dashboard. If their role
  // doesn't grant dashboard, fall through to the first granted page
  // from the fallback list. ABSOLUTE final fallback is also dashboard
  // (NOT settings) so even an empty role_modules read (RLS hiccup,
  // stale session) lands users somewhere expected — Dashboard knows
  // how to render an empty state. Runs once after user + modules load,
  // tracked via useRef so it doesn't fight subsequent nav clicks.
  // Skipped when an email deep-link (?report=…) is present.
  //
  // Critical: both effects gate on `roleModules.status === 'ready' &&
  // roleModules.forUserId === user.id`. The union type makes the
  // user-identity check mandatory — without it, a `ready` payload
  // built for a previous user could satisfy the gate and lock in the
  // wrong route via routedForUserIdRef. See lib/useRoleModules.ts.
  const roleModules = useRoleModules()
  const FALLBACK_ORDER: NavPage[] = [
    'dashboard', 'appointments', 'marketing', 'expenses',
    'buying-events', 'calendar', 'travel', 'staff', 'shipping',
    'reports',
  ]
  useEffect(() => {
    if (!user) return
    if (roleModules.status !== 'ready') return
    if (roleModules.forUserId !== user.id) return
    if (routedForUserIdRef.current === user.id) return
    const grantedModules = roleModules.modules
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      // Email deep-link: `?report=<id>` is handled in a separate
      // effect below — leave nav untouched here so the dedicated
      // Expenses handler can do its thing.
      if (params.has('report')) {
        routedForUserIdRef.current = user.id
        return
      }
      // Email deep-link: `?nav=<page>` — every marketing notification
      // email lands here (proof requests, payment requests, escalations,
      // edit-zips). Honor the URL's nav if it's a real NavPage and the
      // user has access. Strip ?nav from the URL after consuming so a
      // browser refresh doesn't keep re-routing — but LEAVE ?campaign
      // intact so CampaignsList can read it (PR #701).
      const navParam = params.get('nav') as NavPage | null
      if (navParam && KNOWN_NAVS.has(navParam) && grantedModules.has(navParam)) {
        routedForUserIdRef.current = user.id
        rawSetNav(navParam)
        params.delete('nav')
        const newSearch = params.toString()
        const newUrl = window.location.pathname + (newSearch ? '?' + newSearch : '') + window.location.hash
        window.history.replaceState({}, '', newUrl)
        return
      }
    }
    routedForUserIdRef.current = user.id
    const next = FALLBACK_ORDER.find(p => grantedModules.has(p)) ?? 'dashboard'
    rawSetNav(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, roleModules])

  // Generic deep-link guard: if the current nav target isn't in the
  // user's role_modules, redirect. Dashboard is the final fallback
  // (not settings) so a role_modules read failure doesn't dump users
  // into the gear-icon page. Settings stays reachable via the gear.
  useEffect(() => {
    if (!user) return
    if (roleModules.status !== 'ready') return
    if (roleModules.forUserId !== user.id) return
    if (nav === 'settings') return  // respect manual gear-icon clicks
    if (roleModules.modules.has(nav)) return
    const next = FALLBACK_ORDER.find(p => roleModules.modules.has(p)) ?? 'dashboard'
    rawSetNav(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleModules, nav, user])

  useEffect(() => {
    setIsMobile(shouldUseMobile())
  }, [])

  // Preload the most-visited heavy modules during browser idle time
  // after auth completes. The dynamic() declarations above only download
  // their chunks when the user actually navigates — preloading the top
  // hits in advance means the first click after sign-in doesn't blank
  // the content area while the chunk downloads. Webpack dedupes: these
  // import() calls reuse the same chunks the dynamic() loaders would
  // pull, so no extra bytes are downloaded twice.
  //
  // Picks the 6 modules our usage data + role_modules grants show as
  // most-likely-next: BuyingEventsView (Hub), Marketing, Expenses,
  // Customers, Schedule, AppointmentsAdmin. Long-tail modules (Admin,
  // Wholesale, Reconciliation, etc.) still pay the small first-click
  // download cost; preloading them would cancel out the bundle savings.
  useEffect(() => {
    if (!user) return
    if (typeof window === 'undefined') return
    const schedule = (cb: () => void) => {
      if ('requestIdleCallback' in window) {
        ;(window as Window & { requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => number })
          .requestIdleCallback(cb, { timeout: 2000 })
      } else {
        setTimeout(cb, 1000)
      }
    }
    schedule(() => {
      void import('@/components/events/BuyingEventsView')
      void import('@/components/marketing/Marketing')
      void import('@/components/expenses/Expenses')
      void import('@/components/customers/Customers')
      void import('@/components/schedule/Schedule')
      void import('@/components/appointments-admin/AppointmentsAdmin')
    })
  }, [user])

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
    return <LoadingSpinner />
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
          {nav === 'buying-communications' && <BuyingCommunications key={navKey} />}
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
          {/* The next three pages are reachable from the mobile
              slide-out menu (see MobileLayout.tsx ALL_PAGES) but were
              missing here, so tapping them set `nav` correctly while
              nothing matched and the body rendered blank. Routes
              mirror the desktop branch below; each component handles
              its own mobile rendering internally where applicable. */}
          {nav === 'buy-intake'    && <IntakePage  key={navKey} />}
          {nav === 'intake-lookup' && <IntakeLookup key={navKey} />}
          {nav === 'wholesale'     && <ModuleGuard moduleId="wholesale"><ModuleWriteGate moduleId="wholesale"><WholesalePage key={navKey} /></ModuleWriteGate></ModuleGuard>}
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
      {/* Hard-block when the user has a pending W-9 request (PR 4
          of the W-9 initiative). Renders on top of everything until
          the form is submitted via /w9/[token]. */}
      <PendingW9Modal />
      <main className="flex-1 overflow-y-auto">
        <BroadcastBanner />
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
        {nav === 'buying-communications' && <BuyingCommunications key={navKey} />}
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
        {nav === 'accounting-hub' && <ModuleGuard moduleId="accounting-hub"><ModuleWriteGate moduleId="accounting-hub"><AccountingHub key={navKey} setNav={setNav} /></ModuleWriteGate></ModuleGuard>}
        {nav === 'reconciliation' && <ModuleGuard moduleId="reconciliation"><ModuleWriteGate moduleId="reconciliation"><ReconciliationPage key={navKey} setNav={setNav} /></ModuleWriteGate></ModuleGuard>}
        {nav === 'wholesale' && <ModuleGuard moduleId="wholesale"><ModuleWriteGate moduleId="wholesale"><WholesalePage key={navKey} /></ModuleWriteGate></ModuleGuard>}
        {nav === 'broadcast' && <ModuleGuard moduleId="broadcast"><ModuleWriteGate moduleId="broadcast"><BroadcastPage key={navKey} /></ModuleWriteGate></ModuleGuard>}
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
        {nav === 'intake-lookup' && <IntakeLookup key={navKey} />}
        {nav === 'buy-intake'    && <IntakePage  key={navKey} />}
      </main>
    </div>
    </>
  )
}
