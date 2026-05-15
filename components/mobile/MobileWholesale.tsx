'use client'

// Mobile version of the Inventory / Wholesale module. Replaces the
// desktop tab strip + multi-pane layout with a bottom-nav 5-tab
// structure tuned for the trade-show scenario:
//
//   💎 Inventory   — search (text + 📷 scan) → cost-forward list →
//                    read-only detail. Primary use case: "what's
//                    this piece's cost?" while standing in a booth.
//   📋 Memos       — list of open memos + drill-in. Create / actions
//                    layer in once we ship v2.
//   💵 Invoices    — list of recent invoices + drill-in. Same v1/v2
//                    split.
//   🏢 Customers   — search + drill-in. Lookup-first; create flows
//                    from the invoice / memo create paths.
//   📊 Today       — 3 KPI cards: sales today / today's memo activity /
//                    items on memo right now.
//
// Desktop tabs that don't make sense on mobile (Vendors, Send to
// Edge, Lists, full Reports) live exclusively on the desktop view.
// Switching to a phone-sized window swaps the desktop module to
// this component via the isMobileDevice() / shouldUseMobile()
// helpers in lib/mobile.ts (called from WholesalePage.tsx).

import { useState } from 'react'
import { useApp } from '@/lib/context'
import MobileInventoryView from './wholesale/MobileInventoryView'
import MobileMemosView    from './wholesale/MobileMemosView'
import MobileInvoicesView from './wholesale/MobileInvoicesView'
import MobileCustomersView from './wholesale/MobileCustomersView'
import MobileTodayView    from './wholesale/MobileTodayView'

type MobileTab = 'inventory' | 'memos' | 'invoices' | 'customers' | 'today'

const TABS: { id: MobileTab; icon: string; label: string }[] = [
  { id: 'inventory', icon: '💎', label: 'Inventory' },
  { id: 'memos',     icon: '📋', label: 'Memos' },
  { id: 'invoices',  icon: '💵', label: 'Invoices' },
  { id: 'customers', icon: '🏢', label: 'Customers' },
  { id: 'today',     icon: '📊', label: 'Today' },
]

export default function MobileWholesale() {
  const { user, brand } = useApp()
  const isAllowed = user?.role === 'superadmin' || user?.role === 'admin'
    || user?.is_partner === true || user?.inventory_access === true
  const [tab, setTab] = useState<MobileTab>('inventory')

  if (!isAllowed) {
    return (
      <div style={{ padding: 24 }}>
        <div className="card" style={{ padding: 20, textAlign: 'center', color: 'var(--mist)' }}>
          You don't have access to the wholesale module.
        </div>
      </div>
    )
  }

  return (
    <div style={{
      // Reserve room at the bottom for the fixed nav. 70px on iOS
      // safe-area-adjusted devices gives a clean bottom margin.
      paddingBottom: 80,
      minHeight: 'calc(100vh - 60px)',
      background: 'var(--cream)',
    }}>
      {/* Compact header — brand + module name. Mirrors the desktop
          header for orientation but at mobile-density. */}
      <div style={{
        padding: '12px 16px',
        background: '#fff',
        borderBottom: '1px solid var(--pearl)',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <h1 style={{ fontSize: 16, fontWeight: 900, margin: 0, color: 'var(--ink)' }}>
            🛒 Inventory
          </h1>
          <span style={{ fontSize: 11, color: 'var(--mist)', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase' }}>
            {brand?.toUpperCase() || '—'}
          </span>
        </div>
      </div>

      {/* Tab content */}
      <div style={{ padding: '12px 12px 0 12px' }}>
        {tab === 'inventory' && <MobileInventoryView />}
        {tab === 'memos'     && <MobileMemosView />}
        {tab === 'invoices'  && <MobileInvoicesView />}
        {tab === 'customers' && <MobileCustomersView />}
        {tab === 'today'     && <MobileTodayView onJump={setTab} />}
      </div>

      {/* Bottom nav — fixed, full-width. 5 even tabs. */}
      <nav style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: '#fff',
        borderTop: '1px solid var(--pearl)',
        display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)',
        zIndex: 100,
        paddingBottom: 'env(safe-area-inset-bottom)',
        boxShadow: '0 -2px 8px rgba(0,0,0,.04)',
      }}>
        {TABS.map(t => {
          const active = t.id === tab
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                background: 'transparent', border: 'none',
                padding: '8px 4px 10px', cursor: 'pointer',
                fontFamily: 'inherit',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                color: active ? 'var(--green-dark)' : 'var(--mist)',
                fontWeight: active ? 800 : 600,
                position: 'relative',
              }}
            >
              {active && (
                <span style={{
                  position: 'absolute', top: 0, left: '15%', right: '15%',
                  height: 2, background: 'var(--green-dark)', borderRadius: 2,
                }} />
              )}
              <span style={{ fontSize: 18 }}>{t.icon}</span>
              <span style={{ fontSize: 10, letterSpacing: '.02em' }}>{t.label}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}
