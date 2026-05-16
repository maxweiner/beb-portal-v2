// GET /api/wholesale/edge/batch/[id]/csv
//
// Serves the authoritative CSV that was uploaded to Storage at
// send time. Same bytes the recipient received — useful when an
// operator wants to re-download (Edge bounced the row count, Mary
// asks for a re-send, etc.).
//
// Distinct from POST /api/wholesale/edge/csv which builds a fresh
// draft CSV from current inventory state. That one is for previews
// BEFORE a send; this one is for the immutable post-send artifact.

import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { pdfAdmin, PHOTO_BUCKET } from '@/lib/wholesale/pdfHelpers'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

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

  const sb = pdfAdmin()
  const { data: batch } = await sb
    .from('edge_batches')
    .select('id, batch_code, csv_path')
    .eq('id', params.id)
    .maybeSingle()
  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
  if (!batch.csv_path) {
    return NextResponse.json({ error: 'CSV not available — this batch may have failed before upload.' }, { status: 410 })
  }

  const { data, error } = await sb.storage.from(PHOTO_BUCKET).download(batch.csv_path)
  if (error || !data) {
    return NextResponse.json({ error: `CSV download failed: ${error?.message || 'unknown'}` }, { status: 500 })
  }
  const buf = Buffer.from(await data.arrayBuffer())
  return new NextResponse(buf as any, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${batch.batch_code}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
