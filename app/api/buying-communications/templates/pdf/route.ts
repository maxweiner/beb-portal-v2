// POST /api/buying-communications/templates/pdf
//
// Parallel to the trunk PDF route — renders a buying-comm template
// draft as a PDF via @react-pdf/renderer. Used by the AI generation
// modal's review-before-save gate.

import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { BuyingTemplatePdfDoc, type BuyingTemplatePdfData } from '@/lib/communications/buyingTemplatePdf'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function hasAccess(me: any): boolean {
  if (!me) return false
  if (me.role === 'superadmin' || me.role === 'admin') return true
  if (me.is_partner === true) return true
  return false
}

export async function POST(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasAccess(me)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: any
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const name = String(body?.name || '').trim()
  const subject_line = String(body?.subject_line || '').trim()
  const text = String(body?.body || '')
  if (!name || !subject_line || !text) {
    return NextResponse.json({ error: 'name, subject_line, body all required' }, { status: 400 })
  }

  const data: BuyingTemplatePdfData = {
    name, subject_line, body: text,
    generatedAt: new Date().toISOString(),
    generatedByName: me.name || me.email || null,
    prompt: body?.prompt ? String(body.prompt).slice(0, 500) : null,
    mode: body?.mode === 'refine' ? 'refine' : 'new',
  }

  const buffer = await renderToBuffer(BuyingTemplatePdfDoc({ data }) as any)
  const filename = `buying-template-draft-${name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 40)}.pdf`
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
