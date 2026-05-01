'use client'

// Smart-collapse wrapper for the 5 phase sections (Setup, Planning,
// Proofing, Payment, Done). Three modes based on where the campaign
// sits relative to this card's phase:
//
//   done   — campaign moved past this phase. Renders a 1-line
//            summary card (clickable to expand).
//   active — campaign is on this phase. Renders children directly
//            (no extra wrapper) so the section's own card markup
//            owns the visual.
//   locked — campaign hasn't reached this phase. Renders a faded
//            preview with "Unlocks when…" hint. Not clickable.
//
// `forceOpen` is the user-override path: clicking a sticky stepper
// node in PhaseTimeline (or clicking a collapsed done summary) flips
// the phase's id into the parent's expandedOverride set, which sets
// forceOpen=true here and re-renders children.
//
// IMPORTANT: when expanded the wrapper is transparent — children
// emit their own `<div className="card">`. PhaseStepCard adds no
// outer chrome. This avoids double-nested cards and keeps the diff
// across the existing section components at zero.

import { forwardRef, type ReactNode } from 'react'
import type { MarketingStatus } from '@/types'
import RoleLabel from './RoleLabel'

const PHASE_INDEX: Record<MarketingStatus, number> = {
  setup: 0, planning: 1, proofing: 2, payment: 3, done: 4,
}

interface Props {
  phase: MarketingStatus
  campaignStatus: MarketingStatus
  number: number
  title: string
  /** Tiny gray suffix after the title, e.g. "(Buyers)". */
  roleSuffix?: string
  /** One-line summary shown when the card is collapsed-done. */
  doneSummary?: ReactNode
  /** Hint shown when the card is locked, e.g. "Unlocks once proof is approved". */
  lockedHint?: ReactNode
  /** When true, render the children even if the phase is done/locked. */
  forceOpen?: boolean
  onToggle?: () => void
  children: ReactNode
}

const PhaseStepCard = forwardRef<HTMLDivElement, Props>(function PhaseStepCard(
  { phase, campaignStatus, number, title, roleSuffix, doneSummary, lockedHint, forceOpen, onToggle, children },
  ref,
) {
  const here = PHASE_INDEX[phase]
  const now  = PHASE_INDEX[campaignStatus]
  const mode: 'done' | 'active' | 'locked' = here < now ? 'done' : here === now ? 'active' : 'locked'
  const expanded = forceOpen || mode === 'active'

  // ── Locked: faded card, not clickable, no children ─────────
  if (mode === 'locked' && !expanded) {
    return (
      <div ref={ref} className="card" style={{
        padding: '12px 16px', marginBottom: 14,
        background: 'var(--cream2)', borderColor: 'var(--pearl)',
        opacity: 0.7,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <PhaseBadge mode="locked" number={number} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ash)' }}>
              {number}. {title}
              {roleSuffix && <RoleLabel>({roleSuffix})</RoleLabel>}
            </div>
            {lockedHint && (
              <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 2, fontStyle: 'italic' }}>
                {lockedHint}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Done collapsed: one-line summary, click to expand ──────
  if (mode === 'done' && !expanded) {
    return (
      <div ref={ref} className="card" style={{ padding: 0, marginBottom: 14 }}>
        <button type="button" onClick={onToggle}
          style={{
            width: '100%', textAlign: 'left',
            background: 'transparent', border: 'none', padding: '12px 16px',
            cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 10,
            whiteSpace: 'normal',
          }}
          aria-expanded={false}
          title="Show details">
          <PhaseBadge mode="done" number={number} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>
              {number}. {title}
              {roleSuffix && <RoleLabel>({roleSuffix})</RoleLabel>}
            </div>
            {doneSummary && (
              <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 2 }}>
                {doneSummary}
              </div>
            )}
          </div>
          <span aria-hidden style={{ fontSize: 11, color: 'var(--mist)' }}>▾ Show</span>
        </button>
      </div>
    )
  }

  // ── Expanded: render children directly. The section's own card
  // markup provides the visual. We just attach a ref + a tiny
  // "▴ Hide" overlay if the user manually expanded a done/locked phase.
  return (
    <div ref={ref}>
      {forceOpen && mode !== 'active' && onToggle && (
        <div style={{
          display: 'flex', justifyContent: 'flex-end',
          marginBottom: -8, marginTop: 0,
          position: 'relative', zIndex: 1,
        }}>
          <button type="button" onClick={onToggle}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontSize: 11, color: 'var(--mist)', fontFamily: 'inherit',
              fontWeight: 700, padding: '4px 8px',
            }}>
            ▴ Hide
          </button>
        </div>
      )}
      {children}
    </div>
  )
})

export default PhaseStepCard

function PhaseBadge({ mode, number }: { mode: 'done' | 'active' | 'locked'; number: number }) {
  const bg = mode === 'done' ? 'var(--green)' : mode === 'active' ? 'var(--green-dark)' : 'var(--cream2)'
  const fg = mode === 'locked' ? 'var(--mist)' : '#fff'
  return (
    <span aria-hidden style={{
      width: 24, height: 24, borderRadius: '50%',
      background: bg, color: fg,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 12, fontWeight: 900, flexShrink: 0,
    }}>
      {mode === 'done' ? '✓' : mode === 'locked' ? '🔒' : number}
    </span>
  )
}
