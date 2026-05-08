// Verifies the Authorization: Bearer <jwt> from a request and resolves
// the canonical users-table row for the caller. Used by the Expenses
// API routes (PDF generate, accountant email) so admin-only / owner-only
// gating can't be spoofed by a tampered request body.

import { createClient } from '@supabase/supabase-js'
import { isAdmin } from '@/lib/permissions'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

export interface AuthedUser {
  /** public.users.id — the app-level user id used in FKs across the schema. */
  id: string
  /** auth.users.id — needed for sb.auth.admin.updateUserById() and similar
   *  Supabase Auth admin operations. Distinct from `id` in this codebase. */
  auth_id: string
  name: string
  email: string
  role: 'buyer' | 'admin' | 'superadmin' | 'pending' | 'marketing' | 'accounting'
  is_partner: boolean
  active: boolean
}

export async function getAuthedUser(req: Request): Promise<AuthedUser | null> {
  const authHeader = req.headers.get('authorization') || ''
  const m = authHeader.match(/^Bearer\s+(.+)$/i)
  if (!m) return null
  const sb = admin()
  const { data: tokenUser, error: tokenErr } = await sb.auth.getUser(m[1])
  if (tokenErr || !tokenUser?.user?.id) return null

  // Match the public.users row primarily by auth_id (the auth.users
  // UUID, which can never drift out of sync with the JWT) and fall
  // back to email (legacy rows where auth_id was never backfilled).
  // Without this, anyone whose Supabase Auth email differs from their
  // public.users.email gets a 401 — which was breaking Max because his
  // auth login is max.weiner@gmail.com but his users row reads
  // max@bebllp.com.
  const COLS = 'id, auth_id, name, email, role, is_partner, active'
  let row: any = null
  {
    const { data } = await sb.from('users')
      .select(COLS)
      .eq('auth_id', tokenUser.user.id)
      .maybeSingle()
    row = data
  }
  if (!row && tokenUser.user.email) {
    const { data } = await sb.from('users')
      .select(COLS)
      .eq('email', tokenUser.user.email)
      .maybeSingle()
    row = data
  }
  // Final fallback: match the JWT email against any user's
  // alternate_emails text[]. Mirrors what the client-side context
  // loader already does so a Gmail-side login routes to the
  // canonical bebllp row on Max's account.
  if (!row && tokenUser.user.email) {
    const { data } = await sb.from('users')
      .select(COLS)
      .contains('alternate_emails', [tokenUser.user.email])
      .limit(1)
      .maybeSingle()
    row = data
  }
  if (!row || row.active === false) return null
  return row as AuthedUser
}

export function isAdminLike(u: AuthedUser | null): boolean {
  return !!u && isAdmin(u)
}
