// POST /api/wholesale/report/pdf
// Body: { brand, reportLabel, dateRange?, columns, rows }
// Renders the Liberty-branded report PDF and streams it back. The
// browser already has the data computed (ReportsView ran the same
// queries) so we just take that shape and lay it out.

import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { ReportPdfDoc, type ReportPdfData } from '@/lib/wholesale/reportPdf'
import { loadBrandDisplay, loadBrandLogoDataUrl } from '@/lib/wholesale/pdfHelpers'

export const dynamic = 'force-dynamic'

function isAllowed(role: string | null | undefined, isPartner: boolean | null | undefined) {
  return role === 'superadmin' || role === 'admin' || isPartner === true
}

export async function POST(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAllowed(me.role as any, (me as any).is_partner)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const brand = String(body?.brand || '')
  const reportLabel = String(body?.reportLabel || 'Report')
  const columns = Array.isArray(body?.columns) ? body.columns.map(String) : []
  const rows = Array.isArray(body?.rows) ? body.rows : []
  if (!brand || !columns.length) {
    return NextResponse.json({ error: 'brand + columns required' }, { status: 400 })
  }

  const [brandDisplay, brandLogoDataUrl] = await Promise.all([
    loadBrandDisplay(brand),
    loadBrandLogoDataUrl(brand),
  ])

  const data: ReportPdfData = {
    brand,
    brandFullName: brandDisplay.brandFullName,
    brandLogoDataUrl,
    brandAddress: brandDisplay.brandAddress,
    brandPhone: brandDisplay.brandPhone,
    brandEmail: brandDisplay.brandEmail,
    reportLabel,
    generatedAt: new Date().toISOString(),
    dateRange: body?.dateRange?.from && body?.dateRange?.to
      ? { from: String(body.dateRange.from), to: String(body.dateRange.to) }
      : null,
    columns,
    rows,
  }

  const buffer = await renderToBuffer(ReportPdfDoc({ data }) as any)
  const safeName = reportLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const filename = `${safeName}-${brand}-${new Date().toISOString().slice(0,10)}.pdf`
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
