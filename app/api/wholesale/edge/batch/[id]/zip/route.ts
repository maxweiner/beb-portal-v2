// GET /api/wholesale/edge/batch/[id]/zip
//
// Streams a .zip containing the batch CSV + every photo for the
// given batch id. Same wholesale-access gate as the other authed
// edge routes (auth header → role check). Used by the History tab
// in EdgeSendView so operators can grab everything in one shot.
//
// Public mirror lives at /api/wholesale/edge/public/[token]/zip
// for the unauthenticated batch share page.

import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { resolveBatchById, buildBatchZipStream } from '@/lib/wholesale/edgeZip'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function hasWholesaleAccess(me: any): boolean {
  if (!me) return false
  if (me.role === 'superadmin' || me.role === 'admin') return true
  if (me.is_partner === true) return true
  if (me.inventory_access === true) return true
  return false
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasWholesaleAccess(me)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const resolved = await resolveBatchById(params.id)
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
