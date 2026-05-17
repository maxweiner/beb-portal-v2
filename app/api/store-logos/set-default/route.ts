// POST /api/store-logos/set-default
// Body: { parentKind, parentId, index }
//
// Updates default_logo_index on the parent row. The DB trigger
// clamps invalid indices to 0 (the BEFORE trigger reads the array
// length and snaps any out-of-range default back to 0), so the
// server side just writes the requested value.

import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { adminClient, canManageLogos, tableFor, isValidParentKind } from '../_shared'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canManageLogos(me)) {
    return NextResponse.json({ error: 'Admin / superadmin / partner required' }, { status: 403 })
  }

  let body: any
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parentKind = body?.parentKind
  const parentId = (body?.parentId || '').toString()
  const indexRaw = Number(body?.index)
  const index = Number.isFinite(indexRaw) ? Math.floor(indexRaw) : -1

  if (!isValidParentKind(parentKind)) {
    return NextResponse.json({ error: 'parentKind must be "buying" or "trunk"' }, { status: 400 })
  }
  if (!parentId) {
    return NextResponse.json({ error: 'parentId required' }, { status: 400 })
  }
  if (index < 0) {
    return NextResponse.json({ error: 'index must be a non-negative integer' }, { status: 400 })
  }

  const sb = adminClient()
  const { error } = await sb.from(tableFor(parentKind))
    .update({ default_logo_index: index })
    .eq('id', parentId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
