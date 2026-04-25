'use client'

import type { CSSProperties, ReactNode } from 'react'

interface CheckboxProps {
  checked: boolean
  onChange: (next: boolean) => void
  /** Label rendered next to the box. Pass empty for box-only. */
  label?: ReactNode
  disabled?: boolean
  /** Box dimension in px (border counted in this; defaults to 20). */
  size?: number
  /** Box border-radius in px. Defaults to 5. */
  radius?: number
  className?: string
  labelStyle?: CSSProperties
}

const HIDDEN_INPUT: CSSProperties = {
  // Best-practice "visually hidden but still focusable / accessible" trick.
  // We keep the native input in the DOM so label-click toggles it via the
  // standard <label>-wraps-<input> association, and so screen readers still
  // see "checkbox, checked/unchecked".
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
}

/**
 * Standard square + green-✓ checkbox for the whole app. Always render via
 * this component, never a raw <input type="checkbox">.
 */
export default function Checkbox({
  checked,
  onChange,
  label,
  disabled = false,
  size = 20,
  radius = 5,
  className,
  labelStyle,
}: CheckboxProps) {
  return (
    <label
      className={className}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        userSelect: 'none',
        ...labelStyle,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={e => onChange(e.target.checked)}
        style={HIDDEN_INPUT}
      />
      <span
        aria-hidden="true"
        style={{
          width: size,
          height: size,
          flexShrink: 0,
          borderRadius: radius,
          border: `2px solid ${checked ? 'var(--green)' : 'var(--pearl)'}`,
          background: checked ? 'var(--green)' : '#FFFFFF',
          boxSizing: 'border-box',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#FFFFFF',
          fontSize: Math.round(size * 0.65),
          fontWeight: 900,
          lineHeight: 1,
          transition: 'all .15s ease',
        }}
      >
        {checked ? '✓' : ''}
      </span>
      {label && <span style={{ minWidth: 0 }}>{label}</span>}
    </label>
  )
}
