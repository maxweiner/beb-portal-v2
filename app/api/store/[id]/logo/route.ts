// GET /api/store/[id]/logo
//
// Streams `stores.store_image_url` as binary image bytes so it can
// be referenced by an HTTP URL (Open Graph previews in iMessage /
// Slack / etc. won't render base64 data URLs — they need a real
// crawlable URL).
//
// Unauthenticated: this is a public read of the logo so link
// previewers can fetch it. Returns 404 when the store doesn't exist
// or has no logo set; a tiny transparent PNG fallback would also be
// reasonable but 404 keeps cache behavior cleaner.

import { NextResponse } from 'next/server'
import { pdfAdmin } from '@/lib/wholesale/pdfHelpers'

export const dynamic = 'force-dynamic'
// Cache 1h at the CDN; logos rarely change and the OG fetchers are
// notoriously eager. Stale-while-revalidate avoids cold-load latency
// when an unfurler hits the same URL repeatedly.
const CACHE_HEADER = 'public, max-age=3600, stale-while-revalidate=86400, s-maxage=3600'

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const sb = pdfAdmin()
  const { data } = await sb.from('stores')
    .select('store_image_url')
    .eq('id', ctx.params.id)
    .maybeSingle()

  const dataUrl = (data as any)?.store_image_url as string | undefined
  if (!dataUrl) {
    return new NextResponse('Not found', { status: 404 })
  }

  // Expected shape: "data:image/png;base64,iVBORw0KGgo..."
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl)
  if (!m) {
    // Maybe it's already a plain URL (legacy / future-proofing) —
    // 302-redirect to it so the client follows.
    if (/^https?:\/\//i.test(dataUrl)) {
      return NextResponse.redirect(dataUrl, 302)
    }
    return new NextResponse('Unsupported image format', { status: 415 })
  }

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
