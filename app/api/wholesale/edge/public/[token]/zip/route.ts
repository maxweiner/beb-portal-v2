// GET /api/wholesale/edge/public/[token]/zip
//
// Public ZIP download for the Edge batch share page. No auth
// required — gated on the public_token only (revocation-aware
// via resolveBatchByPublicToken). Mary at The Edge gets this URL
// in her notification email and clicks 'Download all'.
//
// Mirrors /api/wholesale/edge/batch/[id]/zip but with the public
// resolver. Both share buildBatchZipStream — same archive shape.

import { NextResponse } from 'next/server'
import { resolveBatchByPublicToken, buildBatchZipStream } from '@/lib/wholesale/edgeZip'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  if (!params.token || params.token.length < 8 || params.token.length > 64) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
  }
  const resolved = await resolveBatchByPublicToken(params.token)
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status })

  const stream = buildBatchZipStream(resolved)
  return new NextResponse(stream as any, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${resolved.batch_code}.zip"`,
      'Cache-Control': 'no-store',
    },
  })
}
