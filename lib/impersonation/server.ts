// Server-side helpers for the "View As" impersonation feature.
//
// SECURITY-CRITICAL: the hardcoded actor email below is the only
// access control. Do NOT refactor it into a flag, role, or
// configurable list. If max@bebllp.com ever changes, this is a
// code change — that's intentional.

import { createClient } from '@supabase/supabase-js'
import { getAuthedUser, type AuthedUser } from '@/lib/expenses/serverAuth'

/**
 * The single hardcoded user permitted to impersonate.
 * Comparisons are case-insensitive.
 */
export const IMPERSONATOR_EMAIL = 'max@bebllp.com'

/**
 * Hard-expires impersonation 4h after start_at. No inactivity
 * tracking — keeps the hook stateless and avoids per-request
 * writes. If you forget to exit, the JWT claim quietly stops
 * resolving once the auth.users.app_metadata expiry is past.
 */
export const IMPERSONATION_TTL_MS = 4 * 60 * 60 * 1000

export function isImpersonator(u: AuthedUser | null | undefined): boolean {
  return !!u && u.email.toLowerCase() === IMPERSONATOR_EMAIL
}

export function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

export interface ActiveImpersonation {
  sessionId: string
  actorId: string
  targetId: string
  startedAt: string
  expiresAt: string
}

/**
 * Returns the active impersonation row for the calling user (by
 * actor_id), or null. Active = ended_at IS NULL AND expires_at
 * > now(). Expired-but-not-ended rows are treated as inactive and
 * cleaned up by stopImpersonation() / status calls.
 */
export async function getActiveImpersonation(
  actorUserId: string,
): Promise<ActiveImpersonation | null> {
  const sb = adminClient()
  const { data, error } = await sb
    .from('impersonation_sessions')
    .select('id, actor_id, target_id, started_at, expires_at, ended_at')
    .eq('actor_id', actorUserId)
    .is('ended_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return {
    sessionId: data.id,
    actorId: data.actor_id,
    targetId: data.target_id,
    startedAt: data.started_at,
    expiresAt: data.expires_at,
  }
}

/**
 * Server-side check used by destructive-action gates. Returns
 * the active impersonation context if the request is being made
 * while Max is impersonating someone, else null.
 *
 * Important: this checks the *real* actor's session, NOT the
 * effective (impersonated) user. Action gates need to know "is
 * the user behind this request actually Max in view-as mode?"
 */
export async function getImpersonationContext(req: Request): Promise<{
  actor: AuthedUser
  impersonation: ActiveImpersonation
} | null> {
  const actor = await getAuthedUser(req)
  if (!actor || !isImpersonator(actor)) return null
  const imp = await getActiveImpersonation(actor.id)
  if (!imp) return null
  return { actor, impersonation: imp }
}

/**
 * Convenience for write-side API routes: returns the standard
 * "Disabled in view-as mode" 403 NextResponse if the actor is
 * currently impersonating, else null. Callers do:
 *
 *   const blocked = await blockIfImpersonating(req)
 *   if (blocked) return blocked
 */
export async function blockIfImpersonating(req: Request) {
  const ctx = await getImpersonationContext(req)
  if (!ctx) return null
  const { NextResponse } = await import('next/server')
  return NextResponse.json(
    { error: 'Disabled in view-as mode', impersonation: true },
    { status: 403 },
  )
}
