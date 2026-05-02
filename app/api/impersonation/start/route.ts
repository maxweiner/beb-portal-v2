// POST /api/impersonation/start
//
// Body: { targetUserId: string }
//
// Hardcoded gate: caller must be max@bebllp.com (case-insensitive).
// Anyone else gets 403 — this is intentional and must NOT be
// loosened to a role or config flag. See lib/impersonation/server.ts.
//
// On success: writes auth.users.app_metadata.impersonating_user_id
// + .impersonating_expires_at on Max's auth row, creates an
// impersonation_sessions row + impersonation_log entry. Client
// must call supabase.auth.refreshSession() so the next-issued JWT
// carries the impersonating_user_id claim from the Auth Hook.

import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import {
  IMPERSONATION_TTL_MS,
  adminClient,
  getActiveImpersonation,
  isImpersonator,
} from '@/lib/impersonation/server'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isImpersonator(me)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { targetUserId?: string }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const targetId = (body.targetUserId || '').trim()
  if (!targetId) {
    return NextResponse.json({ error: 'Missing targetUserId' }, { status: 400 })
  }
  if (targetId === me.id) {
    return NextResponse.json({ error: 'Cannot impersonate yourself' }, { status: 400 })
  }

  const sb = adminClient()

  const { data: target, error: targetErr } = await sb
    .from('users')
    .select('id, name, email, role, active')
    .eq('id', targetId)
    .maybeSingle()
  if (targetErr) return NextResponse.json({ error: targetErr.message }, { status: 500 })
  if (!target || target.active === false) {
    return NextResponse.json({ error: 'Target user not found' }, { status: 404 })
  }

  // If an active session already exists for Max, end it before
  // starting the new one. Two concurrent impersonations are not
  // supported — the new target replaces the old.
  const existing = await getActiveImpersonation(me.id)
  if (existing) {
    await sb.from('impersonation_sessions')
      .update({ ended_at: new Date().toISOString() })
      .eq('id', existing.sessionId)
    await sb.from('impersonation_log')
      .update({ ended_at: new Date().toISOString() })
      .eq('actor_id', me.id)
      .is('ended_at', null)
  }

  const startedAt = new Date()
  const expiresAt = new Date(startedAt.getTime() + IMPERSONATION_TTL_MS)

  const { data: session, error: sessErr } = await sb
    .from('impersonation_sessions')
    .insert({
      actor_id: me.id,
      target_id: target.id,
      started_at: startedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
    })
    .select('id, started_at, expires_at')
    .single()
  if (sessErr || !session) {
    return NextResponse.json({ error: sessErr?.message || 'Session insert failed' }, { status: 500 })
  }

  // Best-effort capture for audit; not load-bearing.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null

  await sb.from('impersonation_log').insert({
    actor_id: me.id,
    target_id: target.id,
    started_at: startedAt.toISOString(),
    ip_address: ip,
  })

  // Find the auth.users row id matching Max. The public.users.id
  // is the Supabase Auth UUID (existing convention in this codebase).
  const { error: metaErr } = await sb.auth.admin.updateUserById(me.id, {
    app_metadata: {
      impersonating_user_id: target.id,
      impersonating_expires_at: expiresAt.toISOString(),
    },
  })
  if (metaErr) {
    // Roll back the session row so we don't end up with a "DB says
    // impersonating, JWT says no" mismatch.
    await sb.from('impersonation_sessions')
      .update({ ended_at: new Date().toISOString() })
      .eq('id', session.id)
    return NextResponse.json({ error: `Failed to set claim: ${metaErr.message}` }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    session: {
      id: session.id,
      target: {
        id: target.id,
        name: target.name,
        email: target.email,
        role: target.role,
      },
      startedAt: session.started_at,
      expiresAt: session.expires_at,
    },
    // Caller MUST refresh the session client-side so the new JWT
    // carries the impersonating_user_id claim.
    requiresRefresh: true,
  })
}
