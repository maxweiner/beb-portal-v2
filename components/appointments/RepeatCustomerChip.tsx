// Tiny inline chip that signals "this booking matched an existing
// customer in the store's customer DB." Server-set at insert time
// (see /api/appointments POST). Renders nothing when the prop is
// false-y so callers can drop it next to a customer name without
// wrapping in a ternary.
//
// Style: amber/gold pill — same palette as the "Welcome back" hint
// shown to the customer on the booking page itself, so staff and
// customer both see the same color signal for "repeat".

import React from 'react'

interface Props {
  isRepeat?: boolean | null
  /** When true, drop the leading "Repeat" label and render just the
   *  🔁 emoji. Useful in dense calendar squares where every pixel
   *  counts. */
  compact?: boolean
  /** Optional override for font sizing in tight rows. */
  size?: number
}

export default function RepeatCustomerChip({ isRepeat, compact = false, size }: Props) {
  if (!isRepeat) return null
  const fontSize = size ?? (compact ? 10 : 11)
  return (
    <span
      title="Repeat customer — phone matched an existing customer record"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3,
        padding: compact ? '1px 5px' : '2px 7px',
        borderRadius: 999,
        background: '#FEF3C7',
        color: '#78350F',
        fontSize,
        fontWeight: 800,
        lineHeight: 1.2,
        whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden="true">🔁</span>
      {!compact && <span>Repeat</span>}
    </span>
  )
}
