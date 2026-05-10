// GET /api/wholesale/invoice/[id]/pdf — Liberty-branded invoice PDF.

import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { InvoicePdfDoc, type InvoicePdfData } from '@/lib/wholesale/invoicePdf'
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
  const { data, error } = await sb
    .from('wholesale_invoices')
    .select(`
      *,
      customer:wholesale_customers(*),
      lines:wholesale_invoice_lines(*, item:inventory_items(*)),
      tradeins:wholesale_invoice_tradein_lines(*),
      payments:wholesale_invoice_payments(*)
    `)
    .eq('id', ctx.params.id).maybeSingle()
  if (error || !data) return NextResponse.json({ error: error?.message || 'Invoice not found' }, { status: 404 })

  const inv = data as any
  const [brandDisplay, brandLogoDataUrl] = await Promise.all([
    loadBrandDisplay(inv.brand),
    loadBrandLogoDataUrl(inv.brand),
  ])
  const itemIds: string[] = (inv.lines || []).map((l: any) => l.item_id)
  const photoUrls = await loadPrimaryPhotoDataUrls(itemIds)

  const payload: InvoicePdfData = {
    brand: inv.brand,
    brandFullName: brandDisplay.brandFullName,
    brandLogoDataUrl,
    brandAddress:  brandDisplay.brandAddress,
    brandPhone:    brandDisplay.brandPhone,
    brandEmail:    brandDisplay.brandEmail,
    invoice_number: inv.invoice_number,
    invoice_date:   inv.invoice_date,
    payment_terms:  inv.payment_terms,
    notes:          inv.notes,
    customer: {
      company_name:  inv.customer?.company_name,
      contact_name:  inv.customer?.contact_name,
      address:       inv.customer?.address,
      phone:         inv.customer?.phone,
      email:         inv.customer?.email,
      resale_certificate_number: inv.customer?.resale_certificate_number,
    },
    lines: ((inv.lines || []) as any[]).map(l => ({
      item_number: l.item?.item_number || '—',
      description: l.description || '—',
      sale_price_cents: l.sale_price_cents,
      photo_data_url: photoUrls[l.item_id] || null,
    })),
    tradeins: ((inv.tradeins || []) as any[]).map(t => ({
      description: t.description,
      agreed_price_cents: t.agreed_price_cents,
      category: t.category,
    })),
    payments: ((inv.payments || []) as any[]).map(p => ({
      paid_on: p.paid_on, amount_cents: p.amount_cents, method: p.method, reference: p.reference,
    })),
    subtotal_cents:       inv.subtotal_cents,
    tradein_credit_cents: inv.tradein_credit_cents,
    total_due_cents:      inv.total_due_cents,
    paid_cents:           inv.paid_cents,
  }

  const buffer = await renderToBuffer(InvoicePdfDoc({ data: payload }) as any)
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${inv.invoice_number}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
