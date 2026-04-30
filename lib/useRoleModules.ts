// Loads the current user's effective module set: their role's
// row in role_modules, plus per-user-flag bonuses (is_partner adds
// 'financials', marketing_access adds 'marketing'). Sidebar +
// page-level guards consume this to decide which sections render.
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
  loaded: boolean
}

export function useRoleModules(): RoleModulesState {
  const { user } = useApp()
  const [state, setState] = useState<RoleModulesState>({ modules: new Set(), loaded: false })

  useEffect(() => {
    if (!user?.role) { setState({ modules: new Set(ALWAYS_ALLOWED), loaded: true }); return }
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase.from('role_modules')
        .select('module_id').eq('role_id', user.role)
      if (cancelled) return
      const set = new Set<ModuleId>(ALWAYS_ALLOWED)
      if (!error && data) {
        for (const row of data as { module_id: string }[]) set.add(row.module_id)
      }
      // Per-user flag bonuses — additive on top of role grants.
      if (user.is_partner) set.add('financials')
      if (user.marketing_access) set.add('marketing')
      setState({ modules: set, loaded: true })
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.role, user?.is_partner, user?.marketing_access])

  return state
}
