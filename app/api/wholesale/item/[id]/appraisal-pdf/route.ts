// GET /api/wholesale/item/[id]/appraisal-pdf — Liberty appraisal.

import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { AppraisalPdfDoc, type AppraisalPdfData } from '@/lib/wholesale/appraisalPdf'
import { pdfAdmin, loadBrandDisplay, loadAllPhotoDataUrls, loadBrandLogoDataUrl } from '@/lib/wholesale/pdfHelpers'

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

  // Pull stones in the same parallel batch so jewelry items render
  // their stones-table rows in the appraisal spec list. Cheap because
  // stones-per-item is small.
  const [brandDisplay, brandLogoDataUrl, photos, stonesRes] = await Promise.all([
    loadBrandDisplay((item as any).brand),
    loadBrandLogoDataUrl((item as any).brand),
    loadAllPhotoDataUrls(ctx.params.id, 4),
    sb.from('inventory_item_stones')
      .select('stone_type, shape, count, total_ct, sort_order')
      .eq('item_id', ctx.params.id)
      .order('sort_order', { ascending: true }),
  ])

  const data: AppraisalPdfData = {
    brand:         (item as any).brand,
    brandFullName: brandDisplay.brandFullName,
    brandLogoDataUrl,
    brandAddress:  brandDisplay.brandAddress,
    brandPhone:    brandDisplay.brandPhone,
    brandEmail:    brandDisplay.brandEmail,
    appraiser_name: brandDisplay.appraiserName || me.name || me.email || null,
    prepared_at:   new Date().toISOString(),
    item:          { ...(item as any), stones: (stonesRes.data || []) },
    photos,
  }
  const buffer = await renderToBuffer(AppraisalPdfDoc({ data }) as any)
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="appraisal-${(item as any).item_number}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
