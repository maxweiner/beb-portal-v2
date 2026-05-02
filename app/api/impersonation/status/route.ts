// GET /api/impersonation/status
//
// Returns the caller's active impersonation context (if any),
// or { active: false }. Used by the sidebar switcher to render
// the right label on first paint.
//
// Allowed for any authenticated user — non-impersonators always
// get { active: false }. Cheap.

import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { adminClient, getActiveImpersonation, isImpersonator } from '@/lib/impersonation/server'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!isImpersonator(me)) {
    return NextResponse.json({ active: false })
  }

  const active = await getActiveImpersonation(me.id)
  if (!active) return NextResponse.json({ active: false })

  // Hydrate target details so the UI doesn't need a second hop.
  const sb = adminClient()
  const { data: target } = await sb
    .from('users')
    .select('id, name, email, role')
    .eq('id', active.targetId)
    .maybeSingle()

  if (!target) {
    // Target was deleted while impersonating — fail closed.
    await sb.from('impersonation_sessions')
      .update({ ended_at: new Date().toISOString() })
      .eq('id', active.sessionId)
    await sb.auth.admin.updateUserById(me.id, {
      app_metadata: { impersonating_user_id: null, impersonating_expires_at: null },
    })
    return NextResponse.json({ active: false, reason: 'target-removed' })
  }

  return NextResponse.json({
    active: true,
    session: {
      id: active.sessionId,
      target,
      startedAt: active.startedAt,
      expiresAt: active.expiresAt,
    },
  })
}
