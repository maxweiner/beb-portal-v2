// GET /api/wholesale/edge/batch/[id] — full batch detail for staff
// inspection (the public batch page uses a separate token-keyed route).

import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { pdfAdmin } from '@/lib/wholesale/pdfHelpers'

export const dynamic = 'force-dynamic'

function hasWholesaleAccess(me: any): boolean {
  if (!me) return false
  if (me.role === 'superadmin' || me.role === 'admin') return true
  if (me.is_partner === true) return true
  if (me.inventory_access === true) return true
  return false
}

export async function GET(req: Request, ctx: { params: { id: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasWholesaleAccess(me)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = pdfAdmin()
  const { data: batch, error: bErr } = await sb.from('edge_batches')
    .select('*').eq('id', ctx.params.id).maybeSingle()
  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 })
  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

  const { data: items, error: iErr } = await sb.from('edge_batch_items')
    .select('*').eq('batch_id', batch.id).order('position', { ascending: true })
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 })

  return NextResponse.json({ batch, items: items || [] }, { status: 200 })
}
