// GET /api/brand-logo?brand=beb|liberty
//
// Public endpoint that returns the brand's wordmark as PNG bytes.
// Used by broadcast emails (and any other email template that
// needs an absolute, brand-aware logo URL — email clients can't
// fetch private storage URLs, so this proxies through the public
// portal domain instead).
//
// Resolution order, picking the first hit:
//   1. brand_logos table → brand-logos storage bucket (admin
//      uploads via Settings → Brand Logos)
//   2. /public/<brand>-wordmark.png  (e.g. liberty-wordmark.png)
//   3. /public/beb-wordmark.png      (BEB fallback for any brand)
//
// 24h cache so email clients don't hammer the route.

import { NextResponse } from 'next/server'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const VALID_BRANDS = new Set(['beb', 'liberty'])
const BUNDLED_FALLBACK = path.join(process.cwd(), 'public', 'beb-wordmark.png')

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

function detectImageContentType(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg'
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50) return 'image/png'
  return 'image/png'
}

async function tryDb(brand: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  const sb = admin()
  const { data: row } = await sb.from('brand_logos').select('logo_path').eq('brand', brand).maybeSingle()
  const logoPath = (row as any)?.logo_path
  if (!logoPath) return null
  const { data: file } = await sb.storage.from('brand-logos').download(logoPath)
  if (!file) return null
  const buf = Buffer.from(await file.arrayBuffer())
  return { buffer: buf, contentType: detectImageContentType(buf) }
}

async function tryBundled(filename: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const buf = await readFile(path.join(process.cwd(), 'public', filename))
    return { buffer: buf, contentType: detectImageContentType(buf) }
  } catch { return null }
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const brandParam = (url.searchParams.get('brand') || 'beb').toLowerCase()
  const brand = VALID_BRANDS.has(brandParam) ? brandParam : 'beb'

  const result =
       (await tryDb(brand))
    || (await tryBundled(`${brand}-wordmark.png`))
    || (await tryBundled('beb-wordmark.png'))
    || (await readFile(BUNDLED_FALLBACK).then(b => ({ buffer: b, contentType: 'image/png' })).catch(() => null))

  if (!result) return NextResponse.json({ error: 'Logo not available' }, { status: 404 })

  return new Response(result.buffer as any, {
    status: 200,
    headers: {
      'Content-Type': result.contentType,
      // 24h cache so the same email opening across many recipients
      // doesn't repeatedly hit the storage layer. Vary on brand so
      // the CDN keeps separate cache entries.
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      'Vary': 'Accept',
    },
  })
}
