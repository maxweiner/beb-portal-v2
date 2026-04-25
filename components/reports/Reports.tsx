'use client'

import { useState } from 'react'
import { useApp } from '@/lib/context'
import ReportEditView, { type ReportDef } from './ReportEditView'

const TODAY = new Date()
const fmtToday = TODAY.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const weekStart = (() => {
  const d = new Date(TODAY)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
})()

// Catalogue of every report. Each tile's id matches a row in report_templates.
// `sendEndpoint=null` means no Send button shows; `send_implemented` on the
// template row gates the button when an endpoint exists but the report's
// data-assembly hasn't been wired yet.
const REPORTS: (ReportDef & { Icon: React.FC<{ size?: number; color?: string }>; accent: string })[] = [
  {
    id: 'morning-briefing',
    title: 'Morning Briefing',
    description: "Daily recap email with yesterday's totals per event, weather per city, and an AI-generated shoutout.",
    Icon: SunIcon, accent: '#F59E0B',
    sendEndpoint: '/api/morning-briefing',
    varHint: '{{date}} for the report date',
    sampleVars: { date: fmtToday },
  },
  {
    id: 'end-of-day',
    title: 'End-of-Day Roundup',
    description: "Mirror of Morning Briefing fired at event close — today's final numbers per event.",
    Icon: MoonIcon, accent: '#6366F1',
    sendEndpoint: '/api/end-of-day',
    varHint: '{{date}} for today',
    sampleVars: { date: fmtToday },
  },
  {
    id: 'weekly-summary',
    title: 'Weekly Summary',
    description: "Monday recap covering last week's events, totals, and standout buyers.",
    Icon: CalendarWeekIcon, accent: '#22C55E',
    sendEndpoint: '/api/weekly-summary',
    varHint: '{{weekStart}} for the Monday of the recapped week',
    sampleVars: { weekStart },
  },
  {
    id: 'store-performance',
    title: 'Store Performance',
    description: 'Per-store historical breakdown — best days, lead sources, year-over-year trends.',
    Icon: BarChartIcon, accent: '#3B82F6',
    sendEndpoint: '/api/store-performance',
    varHint: '{{storeName}} for the store being reported on',
    sampleVars: { storeName: 'Sample Store Name' },
  },
  {
    id: 'event-recap',
    title: 'Event Recap PDF',
    description: "One-click recap for a finished 3-day event: per-day, per-buyer, totals.",
    Icon: DocumentIcon, accent: '#A855F7',
    sendEndpoint: '/api/event-recap',
    varHint: '{{storeName}} and {{eventDate}} for the event being recapped',
    sampleVars: { storeName: 'Sample Store Name', eventDate: 'Sat, Apr 27' },
  },
]

export default function Reports() {
  const { user } = useApp()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'
  const [activeId, setActiveId] = useState<string | null>(null)

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

  if (activeId) {
    const def = REPORTS.find(r => r.id === activeId)
    if (def) return <ReportEditView report={def} onBack={() => setActiveId(null)} />
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div style={{ marginBottom: 20 }}>
        <h1 className="text-2xl font-black" style={{ color: 'var(--ink)' }}>Reports</h1>
        <div style={{ fontSize: 13, color: 'var(--mist)', marginTop: 4 }}>
          Edit, preview, and send any report. Click a tile to open its editor.
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
        {REPORTS.map(t => (
          <button key={t.id}
            onClick={() => setActiveId(t.id)}
            style={{
              background: '#fff',
              border: `1px solid var(--pearl)`,
              borderRadius: 14,
              padding: 18,
              textAlign: 'left',
              cursor: 'pointer',
              display: 'flex', flexDirection: 'column', gap: 10,
              transition: 'transform .12s ease, box-shadow .12s ease',
              boxShadow: '0 2px 8px rgba(0,0,0,.04)',
              minWidth: 0, whiteSpace: 'normal', overflowWrap: 'anywhere',
              fontFamily: 'inherit',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.transform = 'translateY(-2px)'
              e.currentTarget.style.boxShadow = `0 8px 18px ${t.accent}22`
            }}
            onMouseLeave={e => {
              e.currentTarget.style.transform = 'none'
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,.04)'
            }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: `${t.accent}1F`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: t.accent, flexShrink: 0,
            }}>
              <t.Icon size={24} color={t.accent} />
            </div>
            <div style={{ width: '100%', minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)', wordBreak: 'break-word' }}>{t.title}</div>
              <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 4, lineHeight: 1.4, wordBreak: 'break-word' }}>{t.description}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

/* ──────────────────── Icons ──────────────────── */

function SunIcon({ size = 22, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  )
}
function MoonIcon({ size = 22, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12.8A8 8 0 1 1 11.2 3a6.5 6.5 0 0 0 9.8 9.8z" />
    </svg>
  )
}
function CalendarWeekIcon({ size = 22, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </svg>
  )
}
function BarChartIcon({ size = 22, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 21V9M9 21V5M15 21v-9M21 21v-6" />
      <path d="M3 21h18" />
    </svg>
  )
}
function DocumentIcon({ size = 22, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  )
}
