// POST /api/wholesale/report/email
// Body: same as /report/pdf + { to: string, message?: string }
// Renders the report PDF and emails it via Resend. Silent no-op if
// the Resend key isn't configured (lib/email.ts handles that).

import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { ReportPdfDoc, type ReportPdfData } from '@/lib/wholesale/reportPdf'
import { loadBrandDisplay, loadBrandLogoDataUrl } from '@/lib/wholesale/pdfHelpers'
import { sendEmail } from '@/lib/email'

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
  const to = String(body?.to || '').trim()
  const message = String(body?.message || '').trim()
  if (!brand || !columns.length) return NextResponse.json({ error: 'brand + columns required' }, { status: 400 })
  if (!to || !to.includes('@')) return NextResponse.json({ error: 'to email required' }, { status: 400 })

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

  const html = `
    <p>Hi,</p>
    <p>Attached is the <strong>${escapeHtml(reportLabel)}</strong> report from ${escapeHtml(brandDisplay.brandFullName)}.</p>
    ${message ? `<p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>` : ''}
    <p style="color:#888;font-size:12px">Sent by ${escapeHtml(me.email || '')} via the wholesale module.</p>
  `

  try {
    const fromName = brand === 'liberty' ? 'Liberty Estate Buyers' : 'Beneficial Estate Buyers'
    const messageId = await sendEmail({
      to,
      subject: `${reportLabel} — ${brandDisplay.brandFullName}`,
      html,
      from: `${fromName} <noreply@updates.bebllp.com>`,
      attachments: [{ filename, content: Buffer.from(buffer).toString('base64') }],
      replyTo: me.email || undefined,
    })
    if (messageId == null) {
      return NextResponse.json({ error: 'Resend API key not configured (set in settings.resend_api_key).' }, { status: 503 })
    }
    return NextResponse.json({ ok: true, message_id: messageId, to })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Email failed' }, { status: 500 })
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!))
}
