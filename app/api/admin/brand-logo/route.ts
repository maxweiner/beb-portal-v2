// POST /api/admin/brand-logo
// Body: { brand: 'beb' | 'liberty', dataUrl: string }
//   dataUrl format: "data:image/png;base64,iVBORw0KGgoAAAA..."
//
// Superadmin only. Decodes the data URL, uploads to the private
// brand-logos bucket at "{brand}/logo-{timestamp}.{ext}", then upserts
// the brand_logos row. Old uploads are left in the bucket — keeping
// history is cheap and rollback-friendly.
//
// GET /api/admin/brand-logo?brand=beb
// Returns: { logoPath: string | null, signedUrl: string | null,
//   updatedAt: string | null }
//
// Used by the Settings panel to render a preview of the current logo
// (signed URL with a short TTL — file stays private).

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'

export const dynamic = 'force-dynamic'

const ALLOWED_BRANDS = ['beb', 'liberty'] as const
type Brand = typeof ALLOWED_BRANDS[number]
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const
const MAX_BYTES = 5 * 1024 * 1024 // 5MB
const PREVIEW_TTL = 60 * 5 // 5 minutes

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

function extFromMime(mime: string): string {
  switch (mime) {
    case 'image/png': return 'png'
    case 'image/jpeg': return 'jpg'
    case 'image/webp': return 'webp'
    case 'image/svg+xml': return 'svg'
    default: return 'bin'
  }
}

export async function POST(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (me.role !== 'superadmin') {
    return NextResponse.json({ error: 'Superadmin required' }, { status: 403 })
  }

  let body: any
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const brand = (body?.brand || '').toString() as Brand
  const dataUrl = (body?.dataUrl || '').toString()
  if (!ALLOWED_BRANDS.includes(brand)) {
    return NextResponse.json({ error: `Unknown brand: ${brand}` }, { status: 400 })
  }
  const m = /^data:([a-z0-9.+/-]+);base64,(.+)$/i.exec(dataUrl)
  if (!m) return NextResponse.json({ error: 'dataUrl must be a base64-encoded data: URL' }, { status: 400 })

  const mime = m[1].toLowerCase()
  if (!(ALLOWED_MIME as readonly string[]).includes(mime)) {
    return NextResponse.json({ error: `Unsupported image type: ${mime}` }, { status: 400 })
  }

  const buf = Buffer.from(m[2], 'base64')
  if (buf.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: `Logo too large (max ${MAX_BYTES / 1024 / 1024}MB)` }, { status: 400 })
  }

  const sb = admin()
  const path = `${brand}/logo-${Date.now()}.${extFromMime(mime)}`
  const { error: upErr } = await sb.storage.from('brand-logos').upload(path, buf, {
    contentType: mime, upsert: false,
  })
  if (upErr) return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 })

  const { error: dbErr } = await sb.from('brand_logos').upsert({
    brand, logo_path: path, mime_type: mime,
    uploaded_by: me.id, uploaded_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'brand' })
  if (dbErr) return NextResponse.json({ error: `DB upsert failed: ${dbErr.message}` }, { status: 500 })

  const { data: signed } = await sb.storage.from('brand-logos').createSignedUrl(path, PREVIEW_TTL)
  return NextResponse.json({
    ok: true, brand, logoPath: path, mimeType: mime,
    signedUrl: signed?.signedUrl ?? null,
  })
}

export async function GET(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Read access is broad — any signed-in user may fetch the current
  // logo for their active brand (so non-admin surfaces can render it).
  const url = new URL(req.url)
  const brand = (url.searchParams.get('brand') || '').toString() as Brand
  if (!ALLOWED_BRANDS.includes(brand)) {
    return NextResponse.json({ error: `Unknown brand: ${brand}` }, { status: 400 })
  }

  const sb = admin()
  const { data: row } = await sb.from('brand_logos').select('logo_path, updated_at').eq('brand', brand).maybeSingle()
  if (!row?.logo_path) {
    return NextResponse.json({ logoPath: null, signedUrl: null, updatedAt: null })
  }
  const { data: signed } = await sb.storage.from('brand-logos').createSignedUrl(row.logo_path, PREVIEW_TTL)
  return NextResponse.json({
    logoPath: row.logo_path,
    signedUrl: signed?.signedUrl ?? null,
    updatedAt: row.updated_at,
  })
}
