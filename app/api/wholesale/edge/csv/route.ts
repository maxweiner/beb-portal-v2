// POST /api/wholesale/edge/csv
//
// Body: { brand: 'liberty' | 'beb', item_ids: string[] }
// → 200 text/csv (download)
//
// Generates exactly the same 84-column Edge Marketplace CSV that the
// real /api/wholesale/edge/batch endpoint emails to Mary, but DOES
// NOT:
//   - create an edge_batches row
//   - copy photos
//   - send an email
//
// Use case: the operator wants to inspect / archive / hand-deliver
// the CSV without triggering the full send pipeline (no batch row
// minted, no photos copied, no email sent).
//
// Photo cells (Image 1-5 columns) are left BLANK in this CSV. The
// photos are only bundled at real-send time when we mint a batch
// code and copy them into the batch folder. If you need photos +
// CSV together, use 🚀 Send.

import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { pdfAdmin } from '@/lib/wholesale/pdfHelpers'
import { buildSnapshot } from '@/lib/wholesale/edgeSnapshot'
import { buildCsv } from '@/lib/wholesale/edgeCsv'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function hasWholesaleAccess(me: any): boolean {
  if (!me) return false
  if (me.role === 'superadmin' || me.role === 'admin') return true
  if (me.is_partner === true) return true
  if (me.inventory_access === true) return true
  return false
}

export async function POST(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasWholesaleAccess(me)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null) as any
  if (!body) return NextResponse.json({ error: 'Bad JSON' }, { status: 400 })

  const brand = String(body.brand || '').trim()
  if (brand !== 'liberty' && brand !== 'beb') {
    return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
  }
  const itemIds: string[] = Array.isArray(body.item_ids)
    ? body.item_ids.filter((x: any) => typeof x === 'string')
    : []
  if (itemIds.length === 0) return NextResponse.json({ error: 'No items selected' }, { status: 400 })
  if (itemIds.length > 500) return NextResponse.json({ error: 'CSV too large (max 500)' }, { status: 400 })

  const sb = pdfAdmin()

  // Same load pattern as /batch and /preview. Brand-scoped.
  const { data: items, error: itemsErr } = await sb
    .from('inventory_items')
    .select('*')
    .in('id', itemIds)
    .eq('brand', brand)
  if (itemsErr) return NextResponse.json({ error: `Items: ${itemsErr.message}` }, { status: 500 })
  if (!items || items.length === 0) return NextResponse.json({ error: 'No matching items' }, { status: 404 })

  // Preserve client-supplied order.
  const orderById = new Map<string, number>()
  itemIds.forEach((id, i) => orderById.set(id, i))
  const orderedItems = [...(items as any[])].sort((a, b) =>
    (orderById.get(a.id) ?? 9999) - (orderById.get(b.id) ?? 9999))

  const vendorIds = Array.from(new Set(orderedItems.map(i => i.vendor_id).filter(Boolean)))
  const { data: vendors } = vendorIds.length
    ? await sb.from('wholesale_vendors').select('id, brand, company_name').in('id', vendorIds)
    : { data: [] as any[] }
  const vendorById = new Map<string, any>()
  ;(vendors || []).forEach((v: any) => vendorById.set(v.id, v))

  const { data: stones } = await sb.from('inventory_item_stones')
    .select('*').in('item_id', orderedItems.map(i => i.id))
  const stonesByItem = new Map<string, any[]>()
  for (const s of (stones || []) as any[]) {
    const arr = stonesByItem.get(s.item_id) || []
    arr.push(s); stonesByItem.set(s.item_id, arr)
  }

  // Draft batch code is purely a label on the download — no row is
  // inserted. Format mirrors the real batch_code so the CSV looks
  // consistent if Mary glances at it manually.
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const draftBatchCode = `DRAFT-${today}`

  const csvRows = orderedItems.map((it: any, idx: number) => ({
    position: idx + 1,
    batch_code: draftBatchCode,
    snapshot: buildSnapshot({
      item: it,
      vendor: vendorById.get(it.vendor_id) ?? null,
      stones: stonesByItem.get(it.id) || [],
    }),
    photo_filenames: [],  // photos not bundled — see file header
  }))

  const csv = buildCsv(csvRows)

  const filename = `edge-${brand}-${orderedItems.length}items-${new Date().toISOString().slice(0, 10)}.csv`
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
