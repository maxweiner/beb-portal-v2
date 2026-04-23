import type { User, Event } from '@/types'

export function canEditEvent(user: User | null, event: Event | null | undefined): boolean {
  if (!user || !event) return false
  if (user.role === 'admin' || user.role === 'superadmin') return true
  return (event.workers || []).some(w => w.id === user.id)
}
