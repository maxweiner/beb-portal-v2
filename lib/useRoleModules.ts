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

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useApp } from '@/lib/context'

export type ModuleId = string

const ALWAYS_ALLOWED: ModuleId[] = ['settings']

interface RoleModulesState {
  modules: Set<ModuleId>
  /** module_ids where the role is granted READ-ONLY access. */
  readOnly: Set<ModuleId>
  loaded: boolean
  /** True when the user has read+write on the module (or per-user
   *  bonus). False when read-only OR not granted at all. Defaults
   *  to true for grants from rows missing can_write. */
  canWrite: (moduleId: ModuleId) => boolean
}

const EMPTY_STATE: RoleModulesState = {
  modules: new Set(),
  readOnly: new Set(),
  loaded: false,
  canWrite: () => false,
}

export function useRoleModules(): RoleModulesState {
  const { user } = useApp()
  const [state, setState] = useState<RoleModulesState>(EMPTY_STATE)

  useEffect(() => {
    if (!user?.role) {
      const modules = new Set<ModuleId>(ALWAYS_ALLOWED)
      const readOnly = new Set<ModuleId>()
      setState({
        modules, readOnly, loaded: true,
        canWrite: (id) => modules.has(id) && !readOnly.has(id),
      })
      return
    }
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase.from('role_modules')
        .select('module_id, can_write').eq('role_id', user.role)
      if (cancelled) return
      const modules = new Set<ModuleId>(ALWAYS_ALLOWED)
      const readOnly = new Set<ModuleId>()
      if (!error && data) {
        for (const row of data as { module_id: string; can_write: boolean | null }[]) {
          modules.add(row.module_id)
          if (row.can_write === false) readOnly.add(row.module_id)
        }
      }
      // Per-user flag bonuses — additive on top of role grants.
      // Bonuses always grant write (can't read-only via flag).
      if (user.is_partner) { modules.add('financials'); readOnly.delete('financials') }
      if (user.marketing_access) { modules.add('marketing'); readOnly.delete('marketing') }
      setState({
        modules, readOnly, loaded: true,
        canWrite: (id) => modules.has(id) && !readOnly.has(id),
      })
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.role, user?.is_partner, user?.marketing_access])

  return state
}
