'use client'

// Settings-style card with a clickable header that expands/collapses
// the body. Open/closed state persists per-storageKey in localStorage
// so each section remembers its state across reloads + devices (per
// browser).
//
// Designed to drop into existing `<div className="card">` markup with
// minimal change — pass storageKey, title, optional defaultOpen, and
// optional accessory slots for the title row and right side.

import { useEffect, useState, type ReactNode } from 'react'

export default function CollapsibleCard({
  storageKey,
  title,
  defaultOpen = false,
  titleAccessory,
  headerExtra,
  subtitle,
  topAccent,
  children,
}: {
  storageKey: string
  title: ReactNode
  defaultOpen?: boolean
  /** Inline next to the title (e.g. AutosaveIndicator). */
  titleAccessory?: ReactNode
  /** Right side of the header — does NOT toggle when clicked. */
  headerExtra?: ReactNode
  /** Small line under the title. */
  subtitle?: ReactNode
  /** Optional top border color (matches existing per-brand cards). */
  topAccent?: string
  children: ReactNode
}) {
  const lsKey = `collapsible-${storageKey}`
  const [open, setOpen] = useState(defaultOpen)
  // Hydrate from localStorage after mount to avoid SSR mismatch.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(lsKey)
      if (saved === '1') setOpen(true)
      else if (saved === '0') setOpen(false)
    } catch { /* ignore */ }
  }, [lsKey])

  function toggle() {
    setOpen(prev => {
      const next = !prev
      try { localStorage.setItem(lsKey, next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }

  return (
    <div className="card" style={topAccent ? { borderTop: `4px solid ${topAccent}` } : undefined}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          style={{
            flex: 1, minWidth: 0,
            // Explicit justifyContent overrides the global `button {
            // justify-content: center }` rule in globals.css that
            // would otherwise center the chevron + title pair.
            display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 8,
            background: 'transparent', border: 'none', padding: 0, margin: 0,
            cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
            whiteSpace: 'normal',
          }}
        >
          <span aria-hidden style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 16, flexShrink: 0,
            color: 'var(--mist)', fontSize: 11,
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform .15s ease',
          }}>▶</span>
          <span className="card-title" style={{
            margin: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          }}>
            {title}
            {titleAccessory}
          </span>
        </button>
        {headerExtra && (
          <div style={{ flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            {headerExtra}
          </div>
        )}
      </div>
      {subtitle && (
        <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 4, paddingLeft: 24 }}>
          {subtitle}
        </div>
      )}
      {open && (
        <div style={{ marginTop: 14 }}>
          {children}
        </div>
      )}
    </div>
  )
}
