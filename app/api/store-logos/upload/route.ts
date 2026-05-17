// POST /api/store-logos/upload
// Body: { parentKind: 'buying' | 'trunk', parentId: uuid,
//         dataUrl: string, mime: string }
//
// Uploads a single logo to the public `store-logos` bucket at
// `{parentKind}/{parentId}/{uuid}.{ext}`, then appends an entry to
// the parent row's store_logos JSONB array. The DB trigger keeps
// store_image_url in sync with the active default.
//
// PDFs are not accepted server-side — the client (StoreLogoManager)
// rasterizes them to PNG before posting. We accept only image MIMEs
// here so the bucket never holds anything we can't render natively.

import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { adminClient, canManageLogos, tableFor, isValidParentKind, STORE_LOGOS_BUCKET } from '../_shared'
import type { StoreLogoEntry } from '@/lib/storeLogos/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
const MAX_BYTES = 10 * 1024 * 1024 // 10MB — matches the bucket file_size_limit

function extFromMime(mime: string): string {
  switch (mime) {
    case 'image/png':     return 'png'
    case 'image/jpeg':    return 'jpg'
    case 'image/webp':    return 'webp'
    case 'image/svg+xml': return 'svg'
    default:              return 'bin'
  }
}

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
  const dataUrl = (body?.dataUrl || '').toString()
  const mime = (body?.mime || '').toString()

  if (!isValidParentKind(parentKind)) {
    return NextResponse.json({ error: 'parentKind must be "buying" or "trunk"' }, { status: 400 })
  }
  if (!parentId) {
    return NextResponse.json({ error: 'parentId required' }, { status: 400 })
  }
  if (!ALLOWED_MIME.has(mime)) {
    return NextResponse.json({ error: `Unsupported mime: ${mime}` }, { status: 400 })
  }

  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!m) {
    return NextResponse.json({ error: 'dataUrl must be a base64 data URL' }, { status: 400 })
  }
  const buf = Buffer.from(m[2], 'base64')
  if (buf.length > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (${Math.round(buf.length / 1024)}KB > ${MAX_BYTES / 1024 / 1024}MB cap)` },
      { status: 413 },
    )
  }

  const sb = adminClient()
  const table = tableFor(parentKind)

  // Confirm the parent row exists before uploading anything (avoids
  // orphan Storage objects from typo'd parentIds).
  const { data: parentRow, error: parentErr } = await sb.from(table)
    .select('id, store_logos')
    .eq('id', parentId)
    .maybeSingle()
  if (parentErr) return NextResponse.json({ error: parentErr.message }, { status: 500 })
  if (!parentRow) return NextResponse.json({ error: 'Parent not found' }, { status: 404 })

  // Upload first; on DB write failure we'll roll back the Storage object.
  const path = `${parentKind}/${parentId}/${randomUUID()}.${extFromMime(mime)}`
  const { error: upErr } = await sb.storage.from(STORE_LOGOS_BUCKET)
    .upload(path, buf, { contentType: mime, upsert: false })
  if (upErr) {
    return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 })
  }

  const existing = (((parentRow as any).store_logos as StoreLogoEntry[]) || [])
  const entry: StoreLogoEntry = {
    path,
    mime,
    uploaded_at: new Date().toISOString(),
    uploaded_by: me.id,
  }
  const updated = [...existing, entry]

  const { error: updErr } = await sb.from(table)
    .update({ store_logos: updated })
    .eq('id', parentId)
  if (updErr) {
    // Best-effort rollback so the bucket doesn't accumulate orphans.
    await sb.storage.from(STORE_LOGOS_BUCKET).remove([path]).catch(() => {})
    return NextResponse.json({ error: updErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, entry, index: existing.length })
}
