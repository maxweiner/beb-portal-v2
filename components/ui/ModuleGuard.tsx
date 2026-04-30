'use client'

// Page-level access guard. Replaces the older RoleGuard, which gated
// on a hardcoded role list. ModuleGuard reads role_modules — the same
// source of truth the sidebar uses — so granting a role access to a
// module via the Role Manager GUI immediately unlocks the page too.
//
// Usage:
//   <ModuleGuard moduleId="admin"><AdminPanel /></ModuleGuard>
//
// Holds render until role_modules has loaded so the user never sees a
// flash of the locked-out fallback. If a custom fallback is needed,
// pass it via the `fallback` prop.

import type { ReactNode } from 'react'
import { useRoleModules } from '@/lib/useRoleModules'

interface ModuleGuardProps {
  moduleId: string
  children: ReactNode
  fallback?: ReactNode
}

export function ModuleGuard({ moduleId, children, fallback }: ModuleGuardProps) {
  const { modules, loaded } = useRoleModules()
  if (!loaded) return null
  if (modules.has(moduleId)) return <>{children}</>
  if (fallback) return <>{fallback}</>
  return (
    <div className="p-12 text-center" style={{ color: 'var(--mist)' }}>
      <div className="text-4xl mb-4">🔒</div>
      <div className="font-bold text-lg mb-2">Access Restricted</div>
      <div className="text-sm">You don't have permission to view this page.</div>
    </div>
  )
}
