'use client'

// Marketing module — top-level shell with two tabs:
//   - Campaigns: per-event flow management (lands in Phase 3)
//   - Settings: admin configuration (this phase). Superadmin-only.
//
// Per the spec, the Settings tab manages marketing access grants,
// approvers, team email recipients, payment method labels, lead times,
// and the editable email templates. Phase 1 already laid the schema +
// has_marketing_access() helper that gates everything below.

import { useState } from 'react'
import { useApp } from '@/lib/context'
import MarketingSettings from './MarketingSettings'
import CampaignsList from './CampaignsList'

type Tab = 'campaigns' | 'settings'

export default function Marketing() {
  const { user } = useApp()
  const isSuperAdmin = user?.role === 'superadmin'
  const hasMarketingAccess = !!user?.marketing_access
  const [tab, setTab] = useState<Tab>('campaigns')

  // Hard gate: anyone without marketing_access AND not superadmin
  // sees a friendly "no access" card. Mirrors the existing pattern
  // in Reports.tsx.
  if (!hasMarketingAccess && !isSuperAdmin) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="card text-center" style={{ padding: 40 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
          <div className="font-bold" style={{ color: 'var(--ink)', fontSize: 16 }}>
            Marketing access required
          </div>
          <div style={{ fontSize: 13, color: 'var(--mist)', marginTop: 6 }}>
            Ask a superadmin to enable marketing access for your account.
          </div>
        </div>
      </div>
    )
  }

  // Visible tabs depend on role. Non-superadmin marketing users only
  // see Campaigns; superadmins also see Settings.
  const tabs: [Tab, string][] = [
    ['campaigns', 'Campaigns'],
    ...(isSuperAdmin ? ([['settings', 'Settings']] as [Tab, string][]) : []),
  ]

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div style={{ marginBottom: 16 }}>
        <h1 className="text-2xl font-black" style={{ color: 'var(--ink)' }}>📣 Marketing</h1>
        <div style={{ fontSize: 13, color: 'var(--mist)', marginTop: 4 }}>
          Manage VDP and Postcard campaigns. Track proofs, approvals, and payment.
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex', gap: 4, padding: 4, marginBottom: 16,
        background: 'var(--cream2)', borderRadius: 'var(--r)',
        border: '1px solid var(--pearl)', width: 'fit-content',
      }}>
        {tabs.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding: '6px 14px', borderRadius: 'calc(var(--r) - 2px)',
            border: 'none', cursor: 'pointer',
            fontSize: 12, fontWeight: 700,
            background: tab === id ? 'var(--sidebar-bg)' : 'transparent',
            color: tab === id ? '#fff' : 'var(--ash)',
            fontFamily: 'inherit',
          }}>{label}</button>
        ))}
      </div>

      {tab === 'campaigns' && <CampaignsList />}
      {tab === 'settings' && isSuperAdmin && <MarketingSettings />}
    </div>
  )
}
