// POST /api/impersonation/stop
//
// Ends the caller's active impersonation session: clears the
// app_metadata claim on auth.users and stamps ended_at on the
// session + log rows. Idempotent — calling stop when no session
// is active returns ok:true with no-op.
//
// Client must call supabase.auth.refreshSession() after this so
// the next-issued JWT no longer carries impersonating_user_id.

import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { adminClient, getActiveImpersonation, isImpersonator } from '@/lib/impersonation/server'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isImpersonator(me)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sb = adminClient()
  const now = new Date().toISOString()

  // End any active session row(s).
  const active = await getActiveImpersonation(me.id)
  if (active) {
    await sb.from('impersonation_sessions')
      .update({ ended_at: now })
      .eq('id', active.sessionId)
  }

  // Close any open log rows for Max (defensive — should match 1:1
  // with the session row but we don't rely on that).
  await sb.from('impersonation_log')
    .update({ ended_at: now })
    .eq('actor_id', me.id)
    .is('ended_at', null)

  // Clear the claim from app_metadata. Pass nulls (not omission)
  // so Supabase merges out the keys. Uses auth.users.id (auth_id),
  // distinct from public.users.id in this codebase.
  const { error: metaErr } = await sb.auth.admin.updateUserById(me.auth_id, {
    app_metadata: {
      impersonating_user_id: null,
      impersonating_expires_at: null,
    },
  })
  if (metaErr) {
    return NextResponse.json({ error: `Failed to clear claim: ${metaErr.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true, requiresRefresh: true })
}
