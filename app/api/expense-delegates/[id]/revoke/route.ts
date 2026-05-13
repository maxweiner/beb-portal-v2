// POST /api/expense-delegates/[id]/revoke
//
// Soft-deletes a delegation by setting revoked_at = now(). The row
// stays in the table for audit — "who could have filed under Alan
// in May?" must always be answerable.
//
// Hardcoded gate: caller must be max@bebllp.com (case-insensitive).
// See lib/expenseDelegates/server.ts.

import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { adminClient, isDelegateAdmin } from '@/lib/expenseDelegates/server'

export const dynamic = 'force-dynamic'

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isDelegateAdmin(me)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const id = (params?.id || '').trim()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const sb = adminClient()

  // Only revoke active rows. The .is('revoked_at', null) clause
  // makes the call idempotent at the row level — a second revoke
  // on an already-revoked row returns 404 instead of bumping
  // revoked_at forward (which would corrupt the audit timestamp).
  const { data, error } = await sb
    .from('expense_delegates')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .is('revoked_at', null)
    .select('id, revoked_at')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) {
    return NextResponse.json(
      { error: 'Delegation not found or already revoked' },
      { status: 404 },
    )
  }

  return NextResponse.json({ ok: true, delegate: data })
}
