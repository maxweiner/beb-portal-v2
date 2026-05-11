// GET /api/wholesale/memo/[id]/pdf — render the Liberty-branded memo
// PDF for the given memo id. Streams as application/pdf inline.

import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { MemoPdfDoc, type MemoPdfData } from '@/lib/wholesale/memoPdf'
import { pdfAdmin, loadBrandDisplay, loadPrimaryPhotoDataUrls, loadBrandLogoDataUrl } from '@/lib/wholesale/pdfHelpers'

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
  const { data: memo, error } = await sb
    .from('wholesale_memos')
    .select('*, customer:wholesale_customers(*), lines:wholesale_memo_lines(*, item:inventory_items(*))')
    .eq('id', ctx.params.id).maybeSingle()
  if (error || !memo) return NextResponse.json({ error: error?.message || 'Memo not found' }, { status: 404 })

  const m = memo as any
  const [brandDisplay, brandLogoDataUrl] = await Promise.all([
    loadBrandDisplay(m.brand),
    loadBrandLogoDataUrl(m.brand),
  ])
  const itemIds: string[] = (m.lines || []).map((l: any) => l.item_id)
  const photoUrls = await loadPrimaryPhotoDataUrls(itemIds)

  const data: MemoPdfData = {
    brand: m.brand,
    brandFullName: brandDisplay.brandFullName,
    brandLogoDataUrl,
    brandAddress:  brandDisplay.brandAddress,
    brandPhone:    brandDisplay.brandPhone,
    brandEmail:    brandDisplay.brandEmail,
    memo_number:   m.memo_number,
    date_created:  m.date_created,
    due_date:      m.due_date,
    notes:         m.notes,
    customer: {
      company_name:     m.customer?.company_name,
      contact_name:     m.customer?.contact_name,
      // Legacy `address` carried through so PDFs for old rows that
      // pre-date the bill/ship split still render an address line.
      address:          m.customer?.address,
      billing_address:  m.customer?.billing_address,
      shipping_address: m.customer?.shipping_address,
      phone:            m.customer?.phone,
      email:            m.customer?.email,
    },
    lines: ((m.lines || []) as any[]).map(l => ({
      item_number: l.item?.item_number || '—',
      description: l.item?.public_notes || l.item?.jewelry_type || l.item?.watch_brand || l.item?.diamond_report_number || '—',
      memo_price_cents: l.memo_price_cents,
      line_status: l.line_status,
      photo_data_url: photoUrls[l.item_id] || null,
    })),
    termsAndConditions: brandDisplay.termsAndConditions,
  }

  const buffer = await renderToBuffer(MemoPdfDoc({ data }) as any)
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${m.memo_number}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
