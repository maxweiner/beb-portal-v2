// Server-side helpers for the Expense Delegates feature.
//
// SECURITY-CRITICAL: the hardcoded admin email below is the only
// access control for writes. Same single actor as the View-As /
// Role Manager features today, but kept as its own constant so:
//   1. the audit trail of "what feature gates on this email" stays
//      explicit and grep-friendly,
//   2. the three features can diverge in the future without one
//      accidentally pulling in the others.
//
// Reads go through Supabase RLS (see
// supabase-migration-expense-delegates.sql) — delegate, principal,
// and admin/accounting/partner roles all read appropriately.
// Writes go through the API routes in app/api/expense-delegates/
// using the service-role client returned by adminClient().

import { createClient } from '@supabase/supabase-js'
import { type AuthedUser } from '@/lib/expenses/serverAuth'

/**
 * The single user permitted to configure expense delegations.
 * Case-insensitive comparison. Misconfiguring delegation lets
 * someone file expense reports under another user's name, so the
 * gate stays narrow. Do NOT refactor into a flag, role, or
 * configurable list.
 */
export const DELEGATE_ADMIN_EMAIL = 'max@bebllp.com'

export function isDelegateAdmin(u: AuthedUser | null | undefined): boolean {
  return !!u && u.email.toLowerCase() === DELEGATE_ADMIN_EMAIL
}

export function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}
