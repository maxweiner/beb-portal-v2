'use client'

// Sales rep dashboard — custom for role 'sales_rep'. Phase 2
// scaffolds the five sections from the spec; each renders an
// "empty" / "coming soon" state. Real data + interactions land in
// later phases:
//
//   1. Upcoming shows           ← Phase 9 (trade) + Phase 10 (trunk)
//   2. Special requests         ← Phase 11
//   3. Recent leads to follow up ← Phase 6 (manual) + Phase 8 (auto)
//   4. Prospecting notes         ← Phase 6
//   5. Spiffs earned             ← Phase 13
//
// No leaderboard, no commission display (per spec sections 2.5
// and Section 10).

import { useApp } from '@/lib/context'
import type { NavPage } from '@/app/page'

export default function SalesRepDashboard({ setNav }: { setNav?: (n: NavPage) => void }) {
  const { user } = useApp()
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'
  const firstName = (user?.name || '').split(' ')[0] || ''

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Hero */}
      <div style={{
        background: 'linear-gradient(160deg, var(--sidebar-bg) 0%, var(--green-dark) 50%, var(--green) 100%)',
        borderRadius: 16, padding: '20px 24px', marginBottom: 18,
        color: '#fff',
        boxShadow: '0 4px 16px rgba(29,107,68,.18)',
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.8, textTransform: 'uppercase', letterSpacing: '.08em' }}>
          Good {greeting}
        </div>
        <div style={{ fontSize: 24, fontWeight: 900, marginTop: 2 }}>
          {firstName || 'there'}
        </div>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </div>
      </div>

      {/* Two-column on desktop, single-column on mobile */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section
          title="📅 Upcoming Shows"
          subtitle="Trade shows + trunk shows you're assigned to"
          phase="Phase 9 · 10"
          onCta={() => setNav?.('trunk-shows')}
          ctaLabel="Open Trunk Shows →"
        />
        <Section
          title="📣 Special Requests"
          subtitle="Open requests for your upcoming trunk shows"
          phase="Phase 11"
        />
        <Section
          title="🎯 Leads to Follow Up"
          subtitle="Leads assigned to you with action coming due"
          phase="Phase 6 · 8"
          onCta={() => setNav?.('leads')}
          ctaLabel="Open Leads →"
        />
        <Section
          title="📝 Prospecting Notes"
          subtitle="Quick log of calls, store research, field work"
          phase="Phase 6"
        />
        <Section
          title="💰 Spiffs Earned"
          subtitle="This month + year-to-date, paid + owed"
          phase="Phase 13"
          fullSpan
        />
      </div>
    </div>
  )
}

function Section({
  title, subtitle, phase, fullSpan, onCta, ctaLabel,
}: {
  title: string
  subtitle: string
  phase: string
  fullSpan?: boolean
  onCta?: () => void
  ctaLabel?: string
}) {
  return (
    <div className="card"
      style={{
        padding: '18px 20px',
        gridColumn: fullSpan ? '1 / -1' : undefined,
      }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>{title}</div>
          <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 2 }}>{subtitle}</div>
        </div>
        <span style={{
          fontSize: 10, fontWeight: 800, letterSpacing: '.06em',
          textTransform: 'uppercase', color: 'var(--mist)',
          background: 'var(--cream2)', padding: '3px 8px', borderRadius: 999,
          flexShrink: 0,
        }}>{phase}</span>
      </div>
      <div style={{
        marginTop: 14, padding: '20px 14px',
        textAlign: 'center', color: 'var(--mist)', fontSize: 13,
        background: 'var(--cream)', borderRadius: 8,
        fontStyle: 'italic',
      }}>
        Coming soon.
      </div>
      {onCta && ctaLabel && (
        <button
          onClick={onCta}
          className="btn-outline btn-xs"
          style={{ marginTop: 10 }}
        >
          {ctaLabel}
        </button>
      )}
    </div>
  )
}
