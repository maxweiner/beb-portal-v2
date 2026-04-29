import type { User, Event, Role } from '@/types'

export function isAdmin(user: { role?: Role | null } | null | undefined): boolean {
  return user?.role === 'admin' || user?.role === 'superadmin'
}

export function isSuperAdmin(user: { role?: Role | null } | null | undefined): boolean {
  return user?.role === 'superadmin'
}

export function isWorkerAssigned(
  event: { workers?: { id: string }[] | null } | null | undefined,
  userId: string | null | undefined,
): boolean {
  if (!event || !userId) return false
  return (event.workers || []).some(w => w.id === userId)
}

export function canEditEvent(user: User | null, event: Event | null | undefined): boolean {
  if (!user || !event) return false
  if (isAdmin(user)) return true
  return isWorkerAssigned(event, user.id)
}
