// POST /api/store-logos/delete
// Body: { parentKind, parentId, index }
//
// Removes the entry at `index` from the parent's store_logos array
// and deletes the underlying Storage object (unless it's a legacy
// data-URL entry — those have no Storage object to delete). The DB
// trigger handles the default-logo-index adjustment if the deleted
// entry was the active default.

import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { adminClient, canManageLogos, tableFor, isValidParentKind, STORE_LOGOS_BUCKET } from '../_shared'
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
  const table = tableFor(parentKind)

  const { data: row, error: readErr } = await sb.from(table)
    .select('store_logos, default_logo_index')
    .eq('id', parentId)
    .maybeSingle()
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
  if (!row) return NextResponse.json({ error: 'Parent not found' }, { status: 404 })

  const current = (((row as any).store_logos as StoreLogoEntry[]) || [])
  if (index >= current.length) {
    return NextResponse.json({ error: `index ${index} out of bounds (len ${current.length})` }, { status: 400 })
  }

  const victim = current[index]
  const remaining = [...current.slice(0, index), ...current.slice(index + 1)]

  // If we're deleting the active default, snap to 0 in the same write
  // so the trigger doesn't have to clamp twice. If we're deleting a
  // logo *before* the active default, decrement the default to keep
  // pointing at the same logo. Everything else: leave as-is.
  const currentDefault = ((row as any).default_logo_index as number) ?? 0
  let newDefault = currentDefault
  if (index === currentDefault) newDefault = 0
  else if (index < currentDefault) newDefault = currentDefault - 1

  const { error: updErr } = await sb.from(table)
    .update({ store_logos: remaining, default_logo_index: newDefault })
    .eq('id', parentId)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  // Best-effort Storage cleanup. Legacy data-URL entries have no
  // Storage object; skip those. Failures are logged but don't fail
  // the request — the DB row is already updated.
  if (victim && !victim.legacy_data_url && victim.path && !victim.path.startsWith('data:') && !victim.path.startsWith('http')) {
    await sb.storage.from(STORE_LOGOS_BUCKET).remove([victim.path]).catch(() => {})
  }

  return NextResponse.json({ ok: true })
}
