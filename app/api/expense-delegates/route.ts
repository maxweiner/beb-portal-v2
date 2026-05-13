// POST /api/expense-delegates
//
// Body: { delegateUserId: string, principalUserId: string }
//
// Hardcoded gate: caller must be max@bebllp.com (case-insensitive).
// Anyone else gets 403 — this is intentional and must NOT be
// loosened to a role or config flag. See lib/expenseDelegates/server.ts.
//
// Creates an expense_delegates row attributing the action to the
// caller via created_by. The partial unique index on the table
// (delegate_user_id, principal_user_id) WHERE revoked_at IS NULL
// will reject a second active row for the same pair → returns 409.

import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { adminClient, isDelegateAdmin } from '@/lib/expenseDelegates/server'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isDelegateAdmin(me)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { delegateUserId?: string; principalUserId?: string }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const delegateId = (body.delegateUserId || '').trim()
  const principalId = (body.principalUserId || '').trim()
  if (!delegateId || !principalId) {
    return NextResponse.json({ error: 'Missing delegateUserId or principalUserId' }, { status: 400 })
  }
  if (delegateId === principalId) {
    return NextResponse.json({ error: 'Delegate and principal must be different users' }, { status: 400 })
  }

  const sb = adminClient()

  // Verify both users exist + are active. Done in one query for
  // round-trip economy; we then split the result into the two
  // roles so the error message can name which side failed.
  const { data: users, error: usersErr } = await sb
    .from('users')
    .select('id, name, email, active')
    .in('id', [delegateId, principalId])
  if (usersErr) return NextResponse.json({ error: usersErr.message }, { status: 500 })

  const delegate = users?.find(u => u.id === delegateId)
  const principal = users?.find(u => u.id === principalId)
  if (!delegate) return NextResponse.json({ error: 'Delegate user not found' }, { status: 404 })
  if (!principal) return NextResponse.json({ error: 'Principal user not found' }, { status: 404 })
  if (delegate.active === false) {
    return NextResponse.json({ error: `Delegate ${delegate.name || delegate.email} is inactive` }, { status: 400 })
  }
  if (principal.active === false) {
    return NextResponse.json({ error: `Principal ${principal.name || principal.email} is inactive` }, { status: 400 })
  }

  const { data, error } = await sb
    .from('expense_delegates')
    .insert({
      delegate_user_id: delegateId,
      principal_user_id: principalId,
      created_by: me.id,
    })
    .select('id, delegate_user_id, principal_user_id, created_at, created_by, revoked_at')
    .single()

  if (error) {
    // Partial unique index rejection (Postgres unique_violation, 23505)
    // → there's already an active row for this (delegate, principal)
    // pair. Direct the user to revoke the existing row first so the
    // audit trail of the prior delegation is preserved.
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json(
        { error: 'An active delegation for this pair already exists. Revoke it first to re-add.' },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, delegate: data })
}
