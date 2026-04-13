'use client'

import { useApp } from '@/lib/context'
import type { Role } from '@/types'

interface GuardProps {
  roles: Role[]
  children: React.ReactNode
  fallback?: React.ReactNode
}

export function RoleGuard({ roles, children, fallback }: GuardProps) {
  const { user } = useApp()
  if (!user || !roles.includes(user.role)) {
    return fallback ? (
      <>{fallback}</>
    ) : (
      <div className="p-12 text-center" style={{ color: 'var(--mist)' }}>
        <div className="text-4xl mb-4">🔒</div>
        <div className="font-bold text-lg mb-2">Access Restricted</div>
        <div className="text-sm">You don't have permission to view this page.</div>
      </div>
    )
  }
  return <>{children}</>
}
