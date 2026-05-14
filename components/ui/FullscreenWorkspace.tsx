'use client'

// Full-viewport modal that takes a dense view (sheet / row list /
// etc.) out of the sidebar-constrained inline layout and gives it
// the whole screen. Used wherever ~280px of left-sidebar chrome
// makes the inline render cramped: Trunk Shows sheet, Buying
// Events sheet, Inventory sheet, Accounting Hub list, etc.
//
// Behavior:
//   - position: fixed; inset: 0; z-index: 9000 (above sidebar +
//     modals, below the W-9 hard-block at 9999)
//   - Header bar with title + subtitle + ✕ Close button
//   - ESC key dismisses
//   - Body scroll-lock while open
//   - Children scroll inside a flex:1 container so long sheets
//     stay scrollable without losing the header
//
// Usage:
//
//   {fullscreen && (
//     <FullscreenWorkspace
//       title="📚 Trunk Shows · Sheet workspace"
//       subtitle="76 of 101 · ESC to close"
//       onClose={() => setFullscreen(false)}
//     >
//       <TrunkShowSheet ... />
//     </FullscreenWorkspace>
//   )}

import { useEffect, type ReactNode } from 'react'

interface Props {
  title: ReactNode
  subtitle?: ReactNode
  onClose: () => void
  children: ReactNode
  /** Bump the z-index up if a callsite needs to sit above another
   *  modal layer. Default 9000 is above the sidebar (which has no
   *  z-index) but below the W-9 hard-block at 9999. */
  zIndex?: number
}

export default function FullscreenWorkspace({ title, subtitle, onClose, children, zIndex = 9000 }: Props) {
  // ESC dismiss + body scroll-lock. Both live in the same effect
  // so they share the lifetime — added on mount, cleaned up on
  // unmount, no chance of orphaned listeners or a stuck overflow:
  // hidden if the component unmounts mid-render.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const priorOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = priorOverflow
    }
  }, [onClose])

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex,
      background: 'var(--cream)',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'inherit',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px',
        background: '#fff',
        borderBottom: '1px solid var(--pearl)',
        flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--ink)' }}>
            {title}
          </div>
          {subtitle && (
            <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 2 }}>
              {subtitle}
            </div>
          )}
        </div>
        <button onClick={onClose} className="btn-outline btn-sm" title="Close (ESC)">
          ✕ Close
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {children}
      </div>
    </div>
  )
}
