// POST /api/admin/merge-pending
//
// Body: { pendingUserId: string, targetUserId: string }
//
// Admin-or-superadmin only. Used when a self-provisioned 'pending'
// row turns out to be an alias for an existing user (e.g. the
// person signed in with a personal Gmail when they already have
// a row keyed by their work email).
//
// Action:
//   1. Append the pending row's email to target.alternate_emails
//      (de-duplicated, lowercased). The migration that updates
//      get_effective_user_id() makes alternate_emails count for
//      RLS, so future Google sign-ins from that address resolve
//      to the target user with full access.
//   2. Delete the pending row.
//
// We deliberately do NOT swap the target's primary email. That
// would break hardcoded checks (lib/impersonation/server.ts and
// a few Settings/Context guards reference 'max@bebllp.com' by
// string literal). Adding to alternate_emails preserves those
// guards while still recognizing the new login email.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { blockIfImpersonating } from '@/lib/impersonation/server'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function POST(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (me.role !== 'admin' && me.role !== 'superadmin') {
    return NextResponse.json({ error: 'Admin required' }, { status: 403 })
  }

  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  let body: any
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const pendingUserId = String(body?.pendingUserId || '').trim()
  const targetUserId  = String(body?.targetUserId  || '').trim()
  if (!pendingUserId || !targetUserId) {
    return NextResponse.json({ error: 'pendingUserId and targetUserId required' }, { status: 400 })
  }
  if (pendingUserId === targetUserId) {
    return NextResponse.json({ error: 'Cannot merge a user into itself' }, { status: 400 })
  }

  const sb = admin()

  const [pendingRes, targetRes] = await Promise.all([
    sb.from('users').select('id, email, role').eq('id', pendingUserId).maybeSingle(),
    sb.from('users').select('id, email, role, alternate_emails').eq('id', targetUserId).maybeSingle(),
  ])

  const pending = pendingRes.data
  const target  = targetRes.data
  if (!pending) return NextResponse.json({ error: 'Pending user not found' }, { status: 404 })
  if (!target)  return NextResponse.json({ error: 'Target user not found' },  { status: 404 })
  if (pending.role !== 'pending') {
    return NextResponse.json({
      error: `Source row must have role='pending' (got '${pending.role}').`,
    }, { status: 400 })
  }
  if (target.role === 'pending') {
    return NextResponse.json({
      error: 'Target user is also pending — pick a non-pending target.',
    }, { status: 400 })
  }

  const newAlias = (pending.email || '').toLowerCase().trim()
  if (!newAlias) {
    return NextResponse.json({ error: 'Pending row has no email' }, { status: 400 })
  }

  const existing = (target.alternate_emails || []).map((a: string) => (a || '').toLowerCase().trim())
  const merged = Array.from(new Set([
    ...existing.filter(Boolean),
    newAlias,
  ]))

  const { error: updErr } = await sb.from('users')
    .update({ alternate_emails: merged })
    .eq('id', target.id)
  if (updErr) {
    return NextResponse.json({ error: `Failed to update target: ${updErr.message}` }, { status: 500 })
  }

  const { error: delErr } = await sb.from('users').delete().eq('id', pending.id)
  if (delErr) {
    return NextResponse.json({
      error: `Updated alternate_emails but failed to delete pending row: ${delErr.message}`,
    }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    aliasAdded: newAlias,
    targetId: target.id,
    targetEmail: target.email,
  })
}
