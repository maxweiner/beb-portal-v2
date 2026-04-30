'use client'

// Horizontal 5-phase indicator at the top of the campaign detail
// page. This is the minimal version — the spec's full polish (green
// progress bar, accent on current phase, celebration label) lands in
// Phase 13. For now, just shows where the campaign is.

import type { MarketingCampaign, MarketingStatus } from '@/types'

const PHASES: { id: MarketingStatus; label: string }[] = [
  { id: 'setup',    label: 'Setup' },
  { id: 'planning', label: 'Planning' },
  { id: 'proofing', label: 'Proofing' },
  { id: 'payment',  label: 'Payment' },
  { id: 'done',     label: 'Done' },
]

const PHASE_INDEX: Record<MarketingStatus, number> = {
  setup: 0, planning: 1, proofing: 2, payment: 3, done: 4,
}

export default function PhaseTimeline({ campaign }: { campaign: MarketingCampaign }) {
  const currentIdx = PHASE_INDEX[campaign.status] ?? 0
  const allDone = campaign.status === 'done'

  return (
    <div className="card" style={{ padding: 14, marginBottom: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 0, alignItems: 'center', position: 'relative' }}>
        {/* Connecting line */}
        <div style={{
          position: 'absolute', left: '10%', right: '10%', top: 14,
          height: 3, background: 'var(--cream2)', zIndex: 0,
        }} />
        <div style={{
          position: 'absolute', left: '10%', top: 14, height: 3,
          width: `${(currentIdx / 4) * 80}%`,
          background: allDone ? 'var(--green)' : 'var(--green-dark)',
          zIndex: 0, transition: 'width .3s ease',
        }} />

        {PHASES.map((p, i) => {
          const completed = i < currentIdx || allDone
          const current = i === currentIdx && !allDone
          const dotBg = completed
            ? 'var(--green)'
            : current
              ? 'var(--green-dark)'
              : 'var(--cream2)'
          const dotFg = completed || current ? '#fff' : 'var(--mist)'
          return (
            <div key={p.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', zIndex: 1 }}>
              <div style={{
                width: 30, height: 30, borderRadius: '50%',
                background: dotBg, color: dotFg,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: 900,
                border: current ? '2px solid var(--green)' : 'none',
                boxShadow: current ? '0 0 0 4px rgba(29, 107, 68, .15)' : 'none',
              }}>
                {completed ? '✓' : i + 1}
              </div>
              <div style={{
                marginTop: 6, fontSize: 11, fontWeight: 700,
                color: current ? 'var(--green-dark)' : completed ? 'var(--ash)' : 'var(--mist)',
                textAlign: 'center',
              }}>
                {p.label}
              </div>
              {current && campaign.sub_status && (
                <div style={{ marginTop: 2, fontSize: 10, color: 'var(--mist)', textAlign: 'center' }}>
                  {campaign.sub_status.replace(/_/g, ' ')}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {allDone && (
        <div style={{
          marginTop: 12, padding: '8px 12px',
          background: 'var(--green-pale)', color: 'var(--green-dark)',
          borderRadius: 'var(--r)', textAlign: 'center',
          fontSize: 13, fontWeight: 800,
        }}>
          🎉 All set to Buy, Win Win Deals for All
        </div>
      )}
    </div>
  )
}
