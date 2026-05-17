'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type { NavPage } from '@/app/page'
import { usePendingApprovals } from '@/components/expenses/usePendingApprovals'
import { useReconciliationAlerts } from '@/components/reconciliation/useReconciliationAlerts'
import { useLeadFollowUpAlerts } from '@/components/sales/useLeadFollowUpAlerts'
import { useRoleModules } from '@/lib/useRoleModules'
import ViewAsSwitcher from '@/components/impersonation/ViewAsSwitcher'
import { BEB_NAV, LIBERTY_NAV, ALWAYS_VISIBLE_NAV } from '@/lib/sidebarNav'

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
  travel:    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M14 9.5L9.5 8V3.5a1.5 1.5 0 0 0-3 0V8L2 9.5V11l4.5-1.5V13L5 14v1l3-1 3 1v-1l-1.5-1V9.5L14 11V9.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>,
  schedule:  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="3" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M1 7h14" stroke="currentColor" strokeWidth="1.5"/><path d="M5 1v4M11 1v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="5" cy="10" r="1" fill="currentColor"/><circle cx="8" cy="10" r="1" fill="currentColor"/><circle cx="11" cy="10" r="1" fill="currentColor"/></svg>,
  staff:     <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="5" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.5"/><circle cx="11" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.5"/><path d="M1 14c0-2.5 1.8-4 4-4s4 1.5 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M11 10c1.5 0 4 .8 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  settings:  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  expenses:  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2.5" y="1" width="11" height="14" rx="1" stroke="currentColor" strokeWidth="1.5"/><path d="M5.5 4.5h5M5.5 7.5h5M5.5 10.5h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  financials:<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 13V6M6 13V3M10 13V8M14 13V5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  // Selling-side icons. Trade shows = booth/tent silhouette,
  // trunk shows = open suitcase, leads = magnet/target.
  tradeshows:<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 7l6-5 6 5v7H2V7z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="M6 14V9h4v5" stroke="currentColor" strokeWidth="1.5"/></svg>,
  trunkshows:<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="5" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><path d="M6 5V3.5A1.5 1.5 0 0 1 7.5 2h1A1.5 1.5 0 0 1 10 3.5V5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M2 9h12" stroke="currentColor" strokeWidth="1.5"/></svg>,
  leads:     <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/><circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5"/><circle cx="8" cy="8" r="1" fill="currentColor"/></svg>,
}

// Sidebar nav lists + always-visible IDs moved to lib/sidebarNav.ts
// so the Settings → 🧭 Sidebar Items panel can read the same source.

interface SidebarProps {
  nav: NavPage
  setNav: (n: NavPage) => void
}

export default function Sidebar({ nav, setNav }: SidebarProps) {
  const { user, brand, setBrand } = useApp()
  // Pinned-reports loader still uses an isAdmin guard; replaced when
  // PR D sweeps page-level guards. Sidebar item visibility now flows
  // entirely through role_modules below.
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'
  const hasLibertyAccess = user?.liberty_access === true
  const isLiberty = brand === 'liberty'
  // Sidebar items come from the brand's full nav list; access is then
  // filtered against role_modules (DB-driven). Marketing / accounting
  // roles' tiny sidebars come "for free" because their seeded modules
  // only include those few entries.
  const roleModules = useRoleModules()
  const modulesLoaded = roleModules.status === 'ready'
  const grantedModules = roleModules.status === 'ready' ? roleModules.modules : new Set<NavPage>()
  const NAV_ITEMS = isLiberty ? LIBERTY_NAV : BEB_NAV

  // Per-user sidebar visibility. Lives in users.preferences.
  //   .sidebar_hidden_modules: {
  //     desktop: { beb: string[], liberty: string[] },
  //     mobile:  { beb: string[], liberty: string[] },
  //   } — NavPage ids the user has elected to hide. The shape is
  //   per-surface + per-brand so a user can keep a module visible
  //   on desktop but hide it on mobile (or vice-versa) and configure
  //   the two brands independently. Dashboard is hard-pinned via
  //   ALWAYS_VISIBLE_NAV so users can't lock themselves out.
  //   .sidebar_visibility_tip_seen_count: number — how many times
  //     the teaching banner has been auto-shown. Stops at 3
  //     (pattern from buying-events Hub reorder banner).
  // This Sidebar component is the DESKTOP surface; MobileLayout
  // reads the .mobile.<brand> slot independently with the same shape.
  const hiddenModules = useMemo<Set<NavPage>>(() => {
    const root = (user?.preferences as any)?.sidebar_hidden_modules
    const arr = root?.desktop?.[brand as 'beb' | 'liberty']
    if (!Array.isArray(arr)) return new Set()
    return new Set(arr as NavPage[])
  }, [user?.preferences, brand])
  function isHiddenByUser(id?: NavPage): boolean {
    if (!id) return false
    if (ALWAYS_VISIBLE_NAV.includes(id)) return false
    return hiddenModules.has(id)
  }

  // 3-visit teaching banner — once the user has seen this come up 3
  // times we stop showing it. Same shape as the buying-events Hub
  // reorder-tip banner. Setting the dismissed flag persists.
  const TIP_LIMIT = 3
  const [tipSeenCount, setTipSeenCount] = useState<number>(() => {
    const raw = (user?.preferences as any)?.sidebar_visibility_tip_seen_count
    return typeof raw === 'number' ? raw : 0
  })
  const [tipDismissedNow, setTipDismissedNow] = useState(false)
  useEffect(() => {
    // Re-sync if the user object changes (login / brand switch).
    const raw = (user?.preferences as any)?.sidebar_visibility_tip_seen_count
    if (typeof raw === 'number') setTipSeenCount(raw)
  }, [user?.id, user?.preferences])
  // Bump the seen counter once per mount (debounced via a ref so React
  // strict-mode double-mount doesn't double-count). Best-effort write.
  const bumpedRef = useRef(false)
  useEffect(() => {
    if (!user || bumpedRef.current) return
    if (tipSeenCount >= TIP_LIMIT) return
    bumpedRef.current = true
    const next = tipSeenCount + 1
    const nextPrefs = { ...(user.preferences || {}), sidebar_visibility_tip_seen_count: next }
    supabase.from('users').update({ preferences: nextPrefs }).eq('id', user.id).then(() => {
      // No need to refresh user — local count is what gates the
      // banner this session.
    })
    setTipSeenCount(next)
  }, [user, tipSeenCount])
  const showTeachingBanner = !tipDismissedNow && tipSeenCount <= TIP_LIMIT && modulesLoaded

  // Lookup: nav id → its (label, iconKey) so the Pinned section can
  // render rows that match what they look like in the regular sections.
  const navItemById = useMemo(() => {
    const m = new Map<NavPage, { label: string; iconKey?: string }>()
    for (const it of NAV_ITEMS) {
      if (it.id) m.set(it.id, { label: it.label, iconKey: it.iconKey })
    }
    return m
  }, [NAV_ITEMS])

  // Lookup: nav id → its parent section label. Used for default-collapse
  // (only the section containing the active nav opens on first paint).
  const sectionByItemId = useMemo(() => {
    const m = new Map<NavPage, string>()
    let cur: string | null = null
    for (const it of NAV_ITEMS) {
      if (it.section) { cur = it.label; continue }
      if (it.id && cur) m.set(it.id, cur)
    }
    return m
  }, [NAV_ITEMS])

  // Per-section collapse state, persisted to localStorage. NEW default:
  // every section closed except the one containing the active nav.
  // localStorage overrides if the user has manually toggled before.
  const { count: pendingApprovalCount } = usePendingApprovals()
  const { count: reconciliationAlertCount } = useReconciliationAlerts()
  const { count: leadFollowUpCount } = useLeadFollowUpAlerts()
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    // Seed with every section label closed; the active section is opened
    // below in a useEffect once nav + NAV_ITEMS are stable.
    const allLabels = NAV_ITEMS.filter(it => it.section).map(it => it.label)
    return new Set(allLabels)
  })
  const collapseHydrated = useRef(false)
  useEffect(() => {
    if (collapseHydrated.current) return
    collapseHydrated.current = true
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(COLLAPSE_KEY)
      if (raw) {
        // User has manually toggled before — respect their preferences.
        setCollapsed(new Set(JSON.parse(raw)))
        return
      }
    } catch { /* ignore */ }
    // No saved preference: start with every section closed EXCEPT the one
    // containing the current nav. Smart default for the two-tier layout.
    const allLabels = NAV_ITEMS.filter(it => it.section).map(it => it.label)
    const activeSection = sectionByItemId.get(nav)
    const next = new Set(allLabels)
    if (activeSection) next.delete(activeSection)
    setCollapsed(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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


  // Per-user pinned NAV pages. Synced across devices via users.pinned_pages.
  // Hydrated from the user object; togglePin writes back to the DB and
  // updates local state optimistically so the sidebar reflects the change
  // immediately.
  const [pinnedPages, setPinnedPages] = useState<NavPage[]>(
    Array.isArray(user?.pinned_pages) ? (user!.pinned_pages as NavPage[]) : []
  )
  useEffect(() => {
    setPinnedPages(Array.isArray(user?.pinned_pages) ? (user!.pinned_pages as NavPage[]) : [])
  }, [user?.id, user?.pinned_pages])
  const isPinned = (id: NavPage) => pinnedPages.includes(id)
  async function togglePin(id: NavPage) {
    if (!user) return
    const next = isPinned(id)
      ? pinnedPages.filter(p => p !== id)
      : [...pinnedPages, id]
    setPinnedPages(next)
    const { error } = await supabase.from('users')
      .update({ pinned_pages: next }).eq('id', user.id)
    if (error) {
      // Rollback on failure
      setPinnedPages(pinnedPages)
    }
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

      {/* 3-visit teaching banner — discoverability for Settings →
          🧭 Sidebar Items. Auto-shown the first 3 page loads; can
          be dismissed permanently with the × button. */}
      {showTeachingBanner && (
        <div style={{
          margin: '8px 10px 0',
          padding: '8px 10px',
          background: 'rgba(126, 200, 160, 0.12)',
          border: '1px solid rgba(126, 200, 160, 0.3)',
          borderRadius: 8,
          fontSize: 11,
          color: 'rgba(255,255,255,.85)',
          lineHeight: 1.4,
          display: 'flex',
          gap: 8,
          alignItems: 'flex-start',
        }}>
          <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>🧭</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: '#fff' }}>Customize your sidebar</div>
            <div style={{ marginTop: 2 }}>
              Hide modules you don't use in <button
                type="button"
                onClick={() => setNav('settings')}
                style={{
                  background: 'transparent', border: 'none', padding: 0,
                  color: '#7EC8A0', fontWeight: 700, textDecoration: 'underline',
                  cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit',
                }}
              >Settings → 🧭 Sidebar Items</button>.
            </div>
          </div>
          <button
            type="button"
            onClick={async () => {
              setTipDismissedNow(true)
              if (user) {
                const nextPrefs = { ...(user.preferences || {}), sidebar_visibility_tip_seen_count: TIP_LIMIT + 1 }
                await supabase.from('users').update({ preferences: nextPrefs }).eq('id', user.id)
              }
            }}
            aria-label="Dismiss tip"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'rgba(255,255,255,.5)', fontSize: 14, lineHeight: 1,
              padding: 0, flexShrink: 0,
            }}
          >×</button>
        </div>
      )}

      {/* Nav */}
      <nav className="sidebar-nav">
        {/* ★ Pinned section — only renders when the user has any pins.
            Always-open. Pages also remain accessible from their normal
            section below. */}
        {modulesLoaded && pinnedPages.length > 0 && (
          <>
            <div className="nav-group-label" style={{ display: 'block' }}>
              <span style={{ display: 'inline-block', width: 10, marginRight: 4, fontSize: 9 }}>★</span>
              PINNED
            </div>
            {pinnedPages
              .filter(pid => grantedModules.has(pid) && !isHiddenByUser(pid))
              .map(pid => {
                const meta = navItemById.get(pid)
                if (!meta) return null
                const showBadge = pid === 'expenses' && pendingApprovalCount > 0
                const showReconBadge = pid === 'reconciliation' && reconciliationAlertCount > 0
                const pinBadge = showBadge ? pendingApprovalCount
                  : showReconBadge ? reconciliationAlertCount : 0
                return (
                  <NavRow
                    key={`pin-${pid}`}
                    label={meta.label}
                    icon={ICONS[meta.iconKey || '']}
                    active={nav === pid}
                    pinned={true}
                    onClick={() => setNav(pid)}
                    onTogglePin={() => togglePin(pid)}
                    badgeCount={pinBadge}
                  />
                )
              })}
          </>
        )}

        {(() => {
          // Pre-compute which sections have at least one granted item
          // so we can skip empty section headers (e.g. marketing role
          // shouldn't see an empty "Admin" header).
          const sectionsWithGrants = new Set<string>()
          {
            let cur: string | null = null
            for (const it of NAV_ITEMS) {
              if (it.section) { cur = it.label; continue }
              if (cur && it.id && grantedModules.has(it.id) && !isHiddenByUser(it.id)) {
                sectionsWithGrants.add(cur)
              }
            }
          }
          // Walk the flat list, tracking the current section. Items only
          // render when their section is open. Section headers are buttons
          // that toggle the open/closed state.
          let currentSection: string | null = null
          let currentOpen = true
          return NAV_ITEMS.map((item, i) => {
            if (item.section) {
              currentSection = item.label
              currentOpen = !collapsed.has(item.label)
              if (modulesLoaded && !sectionsWithGrants.has(item.label)) return null
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
            // role_modules drives access. Hold render until the modules
            // have loaded so we don't briefly flash the full nav list.
            if (!modulesLoaded) return null
            if (item.id && !grantedModules.has(item.id)) return null
            if (isHiddenByUser(item.id)) return null
            if (currentSection && !currentOpen) return null
            const showExpensesBadge = item.id === 'expenses' && pendingApprovalCount > 0
            const showReconBadge = item.id === 'reconciliation' && reconciliationAlertCount > 0
            const showLeadsBadge = item.id === 'leads' && leadFollowUpCount > 0
            const badge = showExpensesBadge ? pendingApprovalCount
              : showReconBadge ? reconciliationAlertCount
              : showLeadsBadge ? leadFollowUpCount : 0
            const navBtn = (
              <NavRow
                label={item.label}
                icon={ICONS[item.iconKey!]}
                active={nav === item.id}
                pinned={isPinned(item.id!)}
                onClick={() => setNav(item.id!)}
                onTogglePin={() => togglePin(item.id!)}
                badgeCount={badge}
              />
            )
            return <div key={item.id}>{navBtn}</div>
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
        {/* Notifications bell moved to a floating widget at the
            bottom-right of the viewport (mounted in app/page.tsx). */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div className="sidebar-user-name" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.name || user?.email}</div>
          <button
            type="button"
            onClick={() => setNav('settings')}
            aria-label="Settings"
            title="Settings — customize the sidebar under 🧭 Sidebar Items"
            style={{
              flexShrink: 0,
              width: 28, height: 28, padding: 0,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: nav === 'settings' ? 'rgba(255,255,255,.18)' : 'transparent',
              border: '1px solid rgba(255,255,255,.18)',
              borderRadius: 6, cursor: 'pointer',
              color: 'rgba(255,255,255,.85)',
            }}
          >
            {/* macOS System Settings-style gear: 8 rounded teeth + center circle */}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          </button>
        </div>
        <div className="sidebar-user-role">{user?.role?.replace('_', ' ')}</div>
        <ViewAsSwitcher variant="desktop" />
        <button onClick={() => supabase.auth.signOut()} className="btn-outline btn-xs btn-full">Sign Out</button>
      </div>
    </aside>
  )
}

/**
 * Single sidebar nav row. Wraps the nav-item button with an inline
 * pin/unpin star on the right. The pin star is dim until hovered or
 * the item is pinned. Click on the row navigates; click on the star
 * toggles pin state (e.stopPropagation prevents the row click).
 */
function NavRow({
  label, icon, active, pinned, onClick, onTogglePin, badgeCount,
}: {
  label: string
  icon: React.ReactNode
  active: boolean
  pinned: boolean
  onClick: () => void
  onTogglePin: () => void
  badgeCount: number
}) {
  return (
    <div
      className="nav-row"
      style={{ position: 'relative' }}
    >
      <button
        type="button"
        onClick={onClick}
        className={`nav-item${active ? ' active' : ''}`}
        style={{ paddingRight: 30 }}
      >
        <span className="ni-icon">{icon}</span>
        <span style={{ flex: 1 }}>{label}</span>
        {badgeCount > 0 && (
          <span title={`${badgeCount} item(s) awaiting your review`}
            style={{
              background: '#DC2626', color: '#fff',
              borderRadius: 999, padding: '1px 7px',
              fontSize: 10, fontWeight: 800,
              minWidth: 18, textAlign: 'center',
              marginRight: 6,
            }}>{badgeCount}</span>
        )}
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onTogglePin() }}
        title={pinned ? 'Unpin from top' : 'Pin to top'}
        aria-label={pinned ? 'Unpin from top' : 'Pin to top'}
        className="nav-pin"
        style={{
          position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: pinned ? 'var(--green-mute, #7EC8A0)' : 'rgba(255,255,255,.35)',
          fontSize: 12, padding: '4px 6px',
          opacity: pinned ? 1 : 0,
          transition: 'opacity .12s ease, color .12s ease',
        }}
      >
        ★
      </button>
    </div>
  )
}
