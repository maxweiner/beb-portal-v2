'use client'

// Single shared hazard badge for the "Understaffed" indicator. Used on
// event cards, dashboard tiles, and calendar chips so the visual stays
// consistent.
//
// variant='full'    "⚠ Understaffed (2/4)"  — list/card headers
// variant='compact' "⚠ 2/4"                 — small cards / mobile tiles
// variant='icon'    just the icon in a contrast-safe circle — calendar chips

import { AlertTriangle } from 'lucide-react'

const AMBER_BG  = '#FEF3C7'
const AMBER_FG  = '#78350F'
const AMBER_BD  = '#FCD34D'

export interface UnderstaffedBadgeProps {
  assigned: number
  needed: number
  variant?: 'full' | 'compact' | 'icon'
  /** Optional className for caller layout overrides. */
  className?: string
  style?: React.CSSProperties
}

export default function UnderstaffedBadge({
  assigned, needed, variant = 'full', className, style,
}: UnderstaffedBadgeProps) {
  const tooltip = `Understaffed: ${assigned} of ${needed} buyer${needed === 1 ? '' : 's'} assigned`

  if (variant === 'icon') {
    return (
      <span
        title={tooltip}
        className={className}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 18, height: 18, borderRadius: '50%',
          background: '#fff', boxShadow: `0 0 0 1.5px ${AMBER_BD}`,
          color: AMBER_FG, lineHeight: 1, flexShrink: 0,
          ...style,
        }}
      >
        <AlertTriangle size={11} strokeWidth={2.5} />
      </span>
    )
  }

  return (
    <span
      title={tooltip}
      className={className}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        background: AMBER_BG, color: AMBER_FG,
        border: `1px solid ${AMBER_BD}`,
        borderRadius: 6, padding: '2px 6px',
        fontSize: 11, fontWeight: 800, letterSpacing: '.02em',
        whiteSpace: 'nowrap', lineHeight: 1.1,
        ...style,
      }}
    >
      <AlertTriangle size={12} strokeWidth={2.5} />
      {variant === 'full' ? `Understaffed (${assigned}/${needed})` : `${assigned}/${needed}`}
    </span>
  )
}
