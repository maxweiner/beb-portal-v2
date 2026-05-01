'use client'

// Module-wide read-only enforcement. When the current user's role
// has the given module granted as read-only (role_modules.can_write
// === false), this wrapper:
//   1. Renders a banner at the top explaining the state
//   2. Wraps the children in <fieldset disabled> which natively
//      disables every form control inside (input, select, textarea,
//      button) without requiring per-button changes
//
// What it DOESN'T disable:
//   - <a> links and <div onClick> (intentional — navigation should
//     still work)
//   - Direct programmatic supabase-js writes from useEffect or
//     event handlers tied to non-form elements
//
// For the 90% case (forms, buttons, save/edit/delete actions), this
// catches everything in one wrapper. Long-tail edge cases get
// per-component canWrite() checks.

import type { ReactNode } from 'react'
import { useRoleModules } from '@/lib/useRoleModules'

interface Props {
  moduleId: string
  children: ReactNode
}

export default function ModuleWriteGate({ moduleId, children }: Props) {
  const { modules, readOnly, loaded } = useRoleModules()

  // Until loaded, render children un-gated to avoid flashing the
  // banner on/off as state hydrates.
  if (!loaded) return <>{children}</>

  // No grant at all → ModuleGuard upstream should have already blocked
  // the page render. If we reach here without grant, treat as full
  // access (defensive — better to allow than silently break).
  if (!modules.has(moduleId)) return <>{children}</>

  // Read+write grant → no gating.
  if (!readOnly.has(moduleId)) return <>{children}</>

  // Read-only grant → banner + disabled fieldset.
  return (
    <>
      <div style={{
        background: '#FEF3C7', color: '#92400E',
        border: '1px solid #FDE68A', borderRadius: 8,
        padding: '10px 14px', marginBottom: 12,
        fontSize: 13, fontWeight: 600,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span aria-hidden style={{ fontSize: 16 }}>👁️</span>
        Read-only access — you can view this section but not make changes.
        Ask an admin to grant write access if you need to edit.
      </div>
      {/* fieldset is the standard HTML way to disable a tree of form
          controls without per-element edits. Reset its visual chrome
          so it doesn't add a border/padding around the children. */}
      <fieldset disabled style={{
        border: 'none', padding: 0, margin: 0, minWidth: 0,
        // Subtle dimming so disabled state reads as such even on
        // controls that don't visually change much when disabled.
        opacity: 0.92,
      }}>
        {children}
      </fieldset>
    </>
  )
}
