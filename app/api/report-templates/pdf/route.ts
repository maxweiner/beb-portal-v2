// POST /api/report-templates/pdf
//
// Body: {
//   reportId, reportTitle, reportDescription, varHint,
//   subject, greeting, header_subtitle, footer, shoutout_fallback,
//   sampleVars: Record<string,string>,
//   prompt?: string,
//   mode?: 'new' | 'refine',
// }
// → 200 application/pdf
//
// Renders an AI-drafted report template as a PDF so the operator can
// review BEFORE saving via the AI generation modal. Mirrors
// /api/trunk-communications/templates/pdf — Save in the modal stays
// disabled until this route is hit at least once.
//
// Statelessness: takes the template fields IN the request body (not
// by ID) so this works on yet-to-be-saved drafts. No DB write.

import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { ReportTemplatePdfDoc, type ReportTemplatePdfData } from '@/lib/reports/templatePdf'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function hasAccess(me: any): boolean {
  if (!me) return false
  if (me.role === 'superadmin' || me.role === 'admin') return true
  if (me.is_partner === true) return true
  return false
}

function substitute(str: string, vars: Record<string, string>): string {
  return str.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`)
}

export async function POST(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasAccess(me)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: any
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const reportTitle       = String(body?.reportTitle || '').trim()
  const reportDescription = String(body?.reportDescription || '').trim()
  const varHint           = String(body?.varHint || '').trim()
  const subject           = String(body?.subject || '')
  const greeting          = String(body?.greeting || '')
  const header_subtitle   = String(body?.header_subtitle || '')
  const footer            = String(body?.footer || '')
  const shoutout_fallback = String(body?.shoutout_fallback || '')
  const sampleVars        = (body?.sampleVars && typeof body.sampleVars === 'object')
    ? body.sampleVars as Record<string, string>
    : {}

  if (!reportTitle) {
    return NextResponse.json({ error: 'reportTitle required' }, { status: 400 })
  }

  const data: ReportTemplatePdfData = {
    reportTitle,
    reportDescription,
    varHint: varHint || '(no variables defined for this report)',
    raw: { subject, greeting, header_subtitle, footer, shoutout_fallback },
    preview: {
      subject:           substitute(subject, sampleVars),
      greeting:          substitute(greeting, sampleVars),
      header_subtitle:   substitute(header_subtitle, sampleVars),
      footer:            substitute(footer, sampleVars),
      shoutout_fallback: substitute(shoutout_fallback, sampleVars),
    },
    generatedAt: new Date().toISOString(),
    generatedByName: me.name || me.email || null,
    prompt: body?.prompt ? String(body.prompt).slice(0, 500) : null,
    mode: body?.mode === 'refine' ? 'refine' : 'new',
  }

  const buffer = await renderToBuffer(ReportTemplatePdfDoc({ data }) as any)

  const fileSlug = reportTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  const filename = `report-template-draft-${fileSlug || 'report'}.pdf`
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
