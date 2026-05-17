// Shared helpers for the store-logos API routes (upload, set-default,
// reorder, delete). Centralizes the admin-client factory, the gate
// check, and the parent-table mapping so the routes only contain
// their own request handling.

import { createClient } from '@supabase/supabase-js'
import type { AuthedUser } from '@/lib/expenses/serverAuth'
import type { StoreLogoParentKind } from '@/lib/storeLogos/types'

export function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

/** Admin / superadmin / partner can manage logos on either side. */
export function canManageLogos(u: AuthedUser): boolean {
  return u.role === 'admin' || u.role === 'superadmin' || !!u.is_partner
}

export function tableFor(kind: StoreLogoParentKind): 'stores' | 'trunk_show_stores' {
  return kind === 'buying' ? 'stores' : 'trunk_show_stores'
}

export function isValidParentKind(s: any): s is StoreLogoParentKind {
  return s === 'buying' || s === 'trunk'
}

export const STORE_LOGOS_BUCKET = 'store-logos'
