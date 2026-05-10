// GET /api/wholesale/item/[id]/tag-pdf — small printable tag.

import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { ItemTagPdfDoc, type ItemTagPdfData } from '@/lib/wholesale/itemTagPdf'
import { pdfAdmin, BRAND_SHORT_NAME } from '@/lib/wholesale/pdfHelpers'

export const dynamic = 'force-dynamic'

function isAllowed(role: string | null | undefined, isPartner: boolean | null | undefined) {
  return role === 'superadmin' || role === 'admin' || isPartner === true
}

export async function GET(req: Request, ctx: { params: { id: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAllowed(me.role as any, (me as any).is_partner)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const sb = pdfAdmin()
  const { data: item, error } = await sb.from('inventory_items').select('*').eq('id', ctx.params.id).maybeSingle()
  if (error || !item) return NextResponse.json({ error: error?.message || 'Item not found' }, { status: 404 })
  const i = item as any

  const shortLabel = i.category === 'watch'
    ? `${i.watch_brand || ''} ${i.watch_model || ''}`.trim() || '—'
    : i.category === 'diamond'
      ? `${i.diamond_carat || ''}ct ${i.diamond_shape || ''} ${i.diamond_color || ''} ${i.diamond_clarity || ''}`.trim() || '—'
      : `${i.jewelry_metal_karat || ''} ${i.jewelry_type || ''}`.trim() || '—'

  const data: ItemTagPdfData = {
    brand: i.brand,
    brandShortName: BRAND_SHORT_NAME[i.brand] || i.brand.toUpperCase(),
    items: [{
      item_number: i.item_number,
      short_label: shortLabel,
      price_cents: i.retail_price_cents ?? i.wholesale_price_cents ?? null,
    }],
  }
  const buffer = await renderToBuffer(ItemTagPdfDoc({ data }) as any)
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="tag-${i.item_number}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
