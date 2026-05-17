// Loads the current user's effective module set: their role's
// row in role_modules, plus per-user-flag bonuses (is_partner adds
// 'financials', marketing_access adds 'marketing'). Sidebar +
// page-level guards consume this to decide which sections render.
//
// Per-grant write access is exposed via canWrite(moduleId) — defaults
// to true for grants where role_modules.can_write is missing or TRUE,
// and false where the role admin has marked the role as read-only on
// that module. Consumers gate Save buttons + form inputs on canWrite.
//
// Intentionally fetches once on mount + on user change. Modules
// don't move often; if a role admin retoggles modules in the GUI,
// affected users see the change on next page load. Live propagation
// can be a future add (Postgres realtime or a manual refetch event).
//
// The return type is a discriminated union, NOT a `{ loaded: boolean,
// modules, ... }` shape. The previous shape allowed a stale `loaded:
// true` from a prior user (or from the no-user idle state) to leak
// into the brief gap after auth completes but before the next
// role_modules fetch resolves — any consumer gating on `loaded` then
// read the wrong module set for one render, and irreversible state
// (like the ?nav= deep-link router's ref guard in app/page.tsx) could
// lock in the wrong decision. With the union, the only way to read
// `modules` is to first narrow on `status === 'ready'`, and the
// `forUserId` carried with that state lets user-specific gates verify
// the modules belong to THIS user before acting on them.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useApp } from '@/lib/context'

export type ModuleId = string

const ALWAYS_ALLOWED: ModuleId[] = ['settings']

export type RoleModulesState =
  | { status: 'idle' }
  | { status: 'loading'; forUserId: string }
  | {
      status: 'ready'
      forUserId: string
      modules: Set<ModuleId>
      /** module_ids where the role is granted READ-ONLY access. */
      readOnly: Set<ModuleId>
      /** True when the user has read+write on the module (or per-user
       *  bonus). False when read-only OR not granted at all. Defaults
       *  to true for grants from rows missing can_write. */
      canWrite: (moduleId: ModuleId) => boolean
    }

const IDLE_STATE: RoleModulesState = { status: 'idle' }

export function useRoleModules(): RoleModulesState {
  const { user } = useApp()
  const [state, setState] = useState<RoleModulesState>(IDLE_STATE)

  // UNION across every role the user has (multi-role).
  // user.roles is populated by lib/context.tsx and always includes
  // user.role. Read-write wins: if any role grants WRITE, the module
  // is read-write even when a different role grants only read.
  const allRoles = (user?.roles && user.roles.length > 0)
    ? user.roles
    : (user?.role ? [user.role] : [])
  const rolesKey = allRoles.slice().sort().join(',')

  useEffect(() => {
    if (!user || allRoles.length === 0) {
      setState(IDLE_STATE)
      return
    }
    const userId = user.id
    setState({ status: 'loading', forUserId: userId })
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase.from('role_modules')
        .select('module_id, can_write').in('role_id', allRoles)
      if (cancelled) return
      const modules = new Set<ModuleId>(ALWAYS_ALLOWED)
      const writableModules = new Set<ModuleId>()
      if (!error && data) {
        for (const row of data as { module_id: string; can_write: boolean | null }[]) {
          modules.add(row.module_id)
          if (row.can_write !== false) writableModules.add(row.module_id)
        }
      }
      const readOnly = new Set<ModuleId>()
      modules.forEach(m => {
        if (!writableModules.has(m) && !ALWAYS_ALLOWED.includes(m)) readOnly.add(m)
      })
      if (user?.is_partner) { modules.add('financials'); readOnly.delete('financials') }
      if (user?.marketing_access) { modules.add('marketing'); readOnly.delete('marketing') }
      if (user?.inventory_access) { modules.add('wholesale'); readOnly.delete('wholesale') }
      setState({
        status: 'ready',
        forUserId: userId,
        modules,
        readOnly,
        canWrite: (id) => modules.has(id) && !readOnly.has(id),
      })
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, rolesKey, user?.is_partner, user?.marketing_access, user?.inventory_access])

  return state
}
