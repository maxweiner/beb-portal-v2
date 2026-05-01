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
  id: string
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
  if (tokenErr || !tokenUser?.user?.email) return null
  const { data: row } = await sb.from('users')
    .select('id, name, email, role, is_partner, active')
    .eq('email', tokenUser.user.email)
    .maybeSingle()
  if (!row || row.active === false) return null
  return row as AuthedUser
}

export function isAdminLike(u: AuthedUser | null): boolean {
  return !!u && isAdmin(u)
}
