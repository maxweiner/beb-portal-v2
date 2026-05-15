// POST /api/wholesale/edge/preview
//
// Body: { brand: 'liberty' | 'beb', item_ids: string[] }
// → 200 application/pdf (binary)
//
// What it does: builds the same EdgeBatchItemSnapshot the real
// /api/wholesale/edge/batch endpoint builds, but DOES NOT:
//   - create an edge_batches row
//   - copy photos
//   - generate / upload a CSV
//   - send an email
//
// It just renders a one-page-per-N-items review PDF and streams it
// back so the operator can sanity-check the manifest before pulling
// the trigger on a real Send.
//
// Items with no Edge price still render in the preview — the gate
// is enforced by the real /batch endpoint, not here, because part
// of the point of a preview is to spot the items that AREN'T ready.

import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { pdfAdmin, loadPrimaryPhotoDataUrls, loadBrandLogoDataUrl } from '@/lib/wholesale/pdfHelpers'
import { buildSnapshot } from '@/lib/wholesale/edgeSnapshot'
import { EdgePreviewPdfDoc, type EdgePreviewPdfData, type EdgePreviewPdfLine } from '@/lib/wholesale/edgePreviewPdf'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

function hasWholesaleAccess(me: any): boolean {
  if (!me) return false
  if (me.role === 'superadmin' || me.role === 'admin') return true
  if (me.is_partner === true) return true
  if (me.inventory_access === true) return true
  return false
}

function brandFullName(brand: string): string {
  if (brand === 'liberty') return 'Liberty Estate Buyers'
  return 'Beneficial Estate Buyers'
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
  if (itemIds.length > 500) return NextResponse.json({ error: 'Preview too large (max 500)' }, { status: 400 })

  const sb = pdfAdmin()

  // Load items + vendors + stones — same shape as /batch.
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

  // Primary photos (data URLs). Skipping photos for the preview is
  // acceptable — show "(no photo)" placeholder in the cell.
  const photoUrls = await loadPrimaryPhotoDataUrls(orderedItems.map(i => i.id))

  const lines: EdgePreviewPdfLine[] = orderedItems.map((it: any, idx: number) => ({
    position: idx + 1,
    snapshot: buildSnapshot({
      item: it,
      vendor: vendorById.get(it.vendor_id) ?? null,
      stones: stonesByItem.get(it.id) || [],
    }),
    photo_data_url: photoUrls[it.id] || null,
  }))

  const brandLogoDataUrl = await loadBrandLogoDataUrl(brand)

  const pdfData: EdgePreviewPdfData = {
    brand,
    brandFullName: brandFullName(brand),
    brandLogoDataUrl,
    generatedAt: new Date().toISOString(),
    generatedByName: me.name || null,
    generatedByEmail: me.email || null,
    lines,
  }

  const buffer = await renderToBuffer(EdgePreviewPdfDoc({ data: pdfData }) as any)

  const filename = `edge-preview-${brand}-${lines.length}items-${new Date().toISOString().slice(0, 10)}.pdf`
  return new NextResponse(buffer as any, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'no-store',
    },
  })
}
