'use client'

// Reports module shell.
//
// Three tabs:
//   - Reports — AI-powered scheduled reports (ai_reports table)
//   - 📊 Charts — chart builder
//   - Notifications — SMS/email templates (superadmin only)
//
// The pre-2026-05-17 "Templates" tab (cosmetic editor for hardcoded
// report types) and "Custom" tab (Custom Reports v2 SQL-style
// builder) were removed when AI Reports shipped. Hardcoded reports
// (Daily Briefing, Morning Briefing, Event Recap, Checks Issued,
// Expense Submit Reminder, etc.) keep firing via their existing
// cron + API routes — they just don't have an in-portal editor
// anymore. Operators can still tweak the SQL-side cosmetic strings
// in report_templates directly if needed.

import { useState } from 'react'
import { useApp } from '@/lib/context'
import ChartsTab from './ChartsTab'
import NotificationTemplatesAdmin from '@/components/admin/NotificationTemplatesAdmin'
import AiReportsList from './AiReportsList'

type TabId = 'reports' | 'charts' | 'notifications'

export default function Reports() {
  const { user } = useApp()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'
  const isSuperAdmin = user?.role === 'superadmin'
  const [tab, setTab] = useState<TabId>('reports')

  if (!isAdmin) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="card text-center" style={{ padding: 40 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
          <div className="font-bold" style={{ color: 'var(--ink)', fontSize: 16 }}>Admins only</div>
          <div style={{ fontSize: 13, color: 'var(--mist)', marginTop: 6 }}>
            Reports are restricted to admins and superadmins.
          </div>
        </div>
      </div>
    )
  }

  const tabs: ([TabId, string][]) = [
    ['reports', 'Reports'],
    ['charts', '📊 Charts'],
    ...(isSuperAdmin ? ([['notifications', 'Notifications']] as [TabId, string][]) : []),
  ]

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div style={{ marginBottom: 16 }}>
        <h1 className="text-2xl font-black" style={{ color: 'var(--ink)' }}>Reports & Notify</h1>
        <div style={{ fontSize: 13, color: 'var(--mist)', marginTop: 4 }}>
          AI-powered scheduled summaries plus charts and notification triggers.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, padding: 4, marginBottom: 16, background: 'var(--cream2)', borderRadius: 'var(--r)', border: '1px solid var(--pearl)', width: 'fit-content' }}>
        {tabs.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding: '6px 14px', borderRadius: 'calc(var(--r) - 2px)', border: 'none', cursor: 'pointer',
            fontSize: 12, fontWeight: 700,
            background: tab === id ? 'var(--sidebar-bg)' : 'transparent',
            color: tab === id ? '#fff' : 'var(--ash)',
            fontFamily: 'inherit',
          }}>{label}</button>
        ))}
      </div>

      {tab === 'reports' && <AiReportsList />}
      {tab === 'charts' && <ChartsTab />}
      {tab === 'notifications' && (
        <div className="card" style={{ background: '#FFFFFF' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)', marginBottom: 4 }}>SMS Notifications</div>
          <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 12 }}>
            Customer-facing SMS &amp; email templates. Per-brand triggers + legacy appointment templates.
          </div>
          <NotificationTemplatesAdmin embedded />
        </div>
      )}
    </div>
  )
}
