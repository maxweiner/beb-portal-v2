'use client'

// 5-phase progress indicator at the top of every campaign detail page.
// The bar fills green from left to right as the campaign advances; the
// active dot gets a green-ring accent; sub_status (humanized) shows
// under the active dot; on done the bar is fully green and the
// celebration text takes over the bottom strip.

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

// Human-readable copy for the sub_status TEXT values written by the
// API routes. Falls back to the raw value w/ underscores → spaces if
// we encounter something not in the map (workflow may add new values).
const SUB_STATUS_LABEL: Record<string, string> = {
  awaiting_budget:               'Set the budget',
  awaiting_team_notification:    'Notify the team',
  awaiting_planning_submission:  'Awaiting submission',
  awaiting_planning_approval:    'Awaiting approval',
  awaiting_proofs:               'Awaiting proofs',
  awaiting_proof_approval:       'Awaiting approval',
  awaiting_payment_request:      'Ready to request payment',
  awaiting_payment_method:       'Awaiting card pick',
  awaiting_paid_mark:            'Awaiting Mark as Paid',
  complete:                      '',
}

function humanizeSubStatus(raw: string | null | undefined): string {
  if (!raw) return ''
  return SUB_STATUS_LABEL[raw] ?? raw.replace(/_/g, ' ')
}

export default function PhaseTimeline({ campaign }: { campaign: MarketingCampaign }) {
  const currentIdx = PHASE_INDEX[campaign.status] ?? 0
  const allDone = campaign.status === 'done'
  const subStatusText = humanizeSubStatus(campaign.sub_status)

  return (
    <div className="card" style={{
      padding: 14, marginBottom: 14,
      // Subtle green wash on done so the whole strip celebrates.
      background: allDone ? 'var(--green-pale)' : 'var(--card-bg)',
      borderColor: allDone ? 'var(--green3)' : 'var(--pearl)',
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 0, alignItems: 'center', position: 'relative' }}>
        {/* Connecting track + green progress fill */}
        <div style={{
          position: 'absolute', left: '10%', right: '10%', top: 14,
          height: 3, background: 'var(--cream2)', zIndex: 0, borderRadius: 2,
        }} />
        <div style={{
          position: 'absolute', left: '10%', top: 14, height: 3,
          width: `${(currentIdx / 4) * 80}%`,
          background: allDone ? 'var(--green)' : 'var(--green-dark)',
          zIndex: 0, borderRadius: 2,
          transition: 'width .35s ease',
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
                transition: 'background .2s ease, box-shadow .2s ease',
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
              {current && subStatusText && (
                <div style={{ marginTop: 2, fontSize: 10, color: 'var(--mist)', textAlign: 'center', maxWidth: 110, lineHeight: 1.2 }}>
                  {subStatusText}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Celebration line takes over the bottom strip on done */}
      {allDone && (
        <div style={{
          marginTop: 14, padding: '8px 12px',
          background: 'var(--green)', color: '#fff',
          borderRadius: 'var(--r)', textAlign: 'center',
          fontSize: 13, fontWeight: 800, letterSpacing: '.02em',
          boxShadow: '0 1px 3px rgba(0,0,0,.1)',
        }}>
          🎉 All set to Buy, Win Win Deals for All
        </div>
      )}
    </div>
  )
}
