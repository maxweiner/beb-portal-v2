'use client'

// Liberty / wholesale module shell. One client component routed via
// the sidebar nav id 'wholesale'. Internal sub-tabs for Inventory,
// Memos, Invoices, Customers, Vendors, Reports, Admin Lists.

import { useState } from 'react'
import { useApp } from '@/lib/context'
import InventoryView from './InventoryView'
import MemosView from './MemosView'
import InvoicesView from './InvoicesView'
import CustomersView from './CustomersView'
import VendorsView from './VendorsView'
import ReportsView from './ReportsView'
import AdminListsView from './AdminListsView'
import GlobalSearch from './GlobalSearch'

type Tab = 'inventory' | 'memos' | 'invoices' | 'customers' | 'vendors' | 'reports' | 'admin'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'inventory', label: 'Inventory', icon: '💎' },
  { id: 'memos',     label: 'Memos',     icon: '📋' },
  { id: 'invoices',  label: 'Invoices',  icon: '💵' },
  { id: 'customers', label: 'Customers', icon: '🏢' },
  { id: 'vendors',   label: 'Vendors',   icon: '🤝' },
  { id: 'reports',   label: 'Reports',   icon: '📊' },
  { id: 'admin',     label: 'Lists',     icon: '⚙️' },
]

export default function WholesalePage() {
  const { user, brand } = useApp()
  // Superadmin / admin / partner get access by default. The per-user
  // `inventory_access` flag (toggled by superadmin in Admin Panel →
  // Inventory Access) opens the module for anyone else regardless of
  // role — mirrors how `marketing_access` works for the marketing
  // surface.
  const isAllowed = user?.role === 'superadmin' || user?.role === 'admin' || user?.is_partner === true || user?.inventory_access === true
  const [tab, setTab] = useState<Tab>('inventory')

  if (!isAllowed) {
    return (
      <div className="p-6" style={{ maxWidth: 800, margin: '0 auto' }}>
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--mist)' }}>
          You don't have access to the wholesale module.
        </div>
      </div>
    )
  }

  return (
    <div className="p-6" style={{ maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)' }}>
          🛒 Inventory Management <span style={{ fontSize: 13, color: 'var(--mist)', fontWeight: 700 }}>· {brand?.toUpperCase()}</span>
        </h1>
        <div style={{ flex: '1 1 280px', maxWidth: 460 }}>
          <GlobalSearch onJump={(t) => setTab(t)} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, background: 'var(--cream2)', padding: 4, borderRadius: 10, width: 'fit-content', marginBottom: 14, flexWrap: 'wrap' }}>
        {TABS.map(t => {
          const sel = tab === t.id
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
                padding: '6px 14px', border: 'none', borderRadius: 6,
                background: sel ? '#fff' : 'transparent',
                color: sel ? 'var(--green-dark)' : 'var(--mist)',
                cursor: 'pointer',
                boxShadow: sel ? '0 1px 3px rgba(0,0,0,.06)' : 'none',
              }}>
              {t.icon} {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'inventory' && <InventoryView />}
      {tab === 'memos'     && <MemosView />}
      {tab === 'invoices'  && <InvoicesView />}
      {tab === 'customers' && <CustomersView />}
      {tab === 'vendors'   && <VendorsView />}
      {tab === 'reports'   && <ReportsView />}
      {tab === 'admin'     && <AdminListsView />}
    </div>
  )
}
