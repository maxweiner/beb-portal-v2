// POST /api/store-logos/reorder
// Body: { parentKind, parentId, order: number[] }
//
// `order` is a permutation of the current array's indices —
// e.g. [2, 0, 1] means "the entry that was at index 2 becomes the
// first entry, then 0, then 1". The active default follows the move
// so the user's "live" logo never silently changes from a reorder.
//
// The server reads the current array, validates `order` is a
// permutation of [0..len), reorders, recomputes default_logo_index
// to point at the same entry, and writes both columns atomically.

import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { adminClient, canManageLogos, tableFor, isValidParentKind } from '../_shared'
import type { StoreLogoEntry } from '@/lib/storeLogos/types'

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
  const order = Array.isArray(body?.order) ? body.order : null

  if (!isValidParentKind(parentKind)) {
    return NextResponse.json({ error: 'parentKind must be "buying" or "trunk"' }, { status: 400 })
  }
  if (!parentId) {
    return NextResponse.json({ error: 'parentId required' }, { status: 400 })
  }
  if (!order || order.some((n: any) => !Number.isInteger(n))) {
    return NextResponse.json({ error: 'order must be an array of integers' }, { status: 400 })
  }

  const sb = adminClient()
  const table = tableFor(parentKind)

  const { data: row, error: readErr } = await sb.from(table)
    .select('store_logos, default_logo_index')
    .eq('id', parentId)
    .maybeSingle()
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
  if (!row) return NextResponse.json({ error: 'Parent not found' }, { status: 404 })

  const current = (((row as any).store_logos as StoreLogoEntry[]) || [])
  const currentDefault = ((row as any).default_logo_index as number) ?? 0

  // Validate `order` is a permutation of [0..len)
  if (order.length !== current.length) {
    return NextResponse.json({ error: `order length ${order.length} != current length ${current.length}` }, { status: 400 })
  }
  const sortedOrder = [...order].sort((a, b) => a - b)
  for (let i = 0; i < sortedOrder.length; i++) {
    if (sortedOrder[i] !== i) {
      return NextResponse.json({ error: 'order must be a permutation of [0..len)' }, { status: 400 })
    }
  }

  const reordered = order.map((i: number) => current[i])
  const newDefault = order.indexOf(currentDefault)
  // newDefault === -1 should be impossible after the permutation check.

  const { error: updErr } = await sb.from(table)
    .update({ store_logos: reordered, default_logo_index: newDefault < 0 ? 0 : newDefault })
    .eq('id', parentId)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
