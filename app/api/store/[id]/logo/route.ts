// GET /api/store/[id]/logo
//
// Streams the active default logo as binary image bytes so it can
// be referenced by an HTTP URL (Open Graph previews in iMessage /
// Slack / etc. won't render base64 data URLs — they need a real
// crawlable URL).
//
// Reads `stores.store_image_url`, which the sync trigger keeps
// pointing at the active default's path. Three shapes are possible:
//   1. Storage path under `store-logos` → 302 to the public URL
//   2. Legacy base64 data URL → decode and stream the bytes
//   3. Pre-existing absolute http(s) URL → 302 to it
//
// Unauthenticated: this is a public read of the logo so link
// previewers can fetch it. Returns 404 when the store doesn't exist
// or has no logo set.

import { NextResponse } from 'next/server'
import { pdfAdmin } from '@/lib/wholesale/pdfHelpers'

export const dynamic = 'force-dynamic'
// Cache 1h at the CDN; logos rarely change and the OG fetchers are
// notoriously eager. Stale-while-revalidate avoids cold-load latency
// when an unfurler hits the same URL repeatedly.
const CACHE_HEADER = 'public, max-age=3600, stale-while-revalidate=86400, s-maxage=3600'

const STORAGE_PUBLIC_PREFIX = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/store-logos/`

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const sb = pdfAdmin()
  const { data } = await sb.from('stores')
    .select('store_image_url')
    .eq('id', ctx.params.id)
    .maybeSingle()

  const value = (data as any)?.store_image_url as string | undefined
  if (!value) return new NextResponse('Not found', { status: 404 })

  // 1. Absolute http(s) URL → 302
  if (/^https?:\/\//i.test(value)) {
    return NextResponse.redirect(value, 302)
  }

  // 2. Legacy data URL → decode + stream
  const m = /^data:([^;]+);base64,(.+)$/.exec(value)
  if (m) {
    const contentType = m[1] || 'image/png'
    const buf = Buffer.from(m[2], 'base64')
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': CACHE_HEADER,
        'Content-Length': String(buf.length),
      },
    })
  }

  // 3. Storage object key → 302 to the public bucket URL.
  // The store-logos bucket is public-read so unfurlers can fetch
  // directly without a signed URL round-trip.
  return NextResponse.redirect(STORAGE_PUBLIC_PREFIX + value, 302)
}
