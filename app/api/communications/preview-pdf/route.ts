// POST /api/communications/preview-pdf
//
// Renders a letter PDF in-memory and returns it as binary. No
// upload, no log row. Used by the "📄 Preview PDF" button in
// the send flow so the rep can see the branded letter before
// committing to a send.
//
// Body: same as the send endpoint, minus delivery fields:
//   { subject, body, to_email, to_name? }
//
// Auth: any authenticated user with @bebllp.com email — same
// gate as the send endpoint, since the preview encodes the
// rep's name in the footer.

import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { renderLetterBuffer } from '@/lib/communications/generatePdf'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const subject  = String(body.subject || '').trim()
  const bodyText = String(body.body    || '').trim()
  const to_email = String(body.to_email || '').trim()
  const to_name  = body.to_name ? String(body.to_name) : null

  if (!subject || !bodyText) {
    return NextResponse.json({ error: 'subject and body are required' }, { status: 400 })
  }

  try {
    const buffer = await renderLetterBuffer({
      subject,
      body: bodyText,
      storeContact: { name: to_name, email: to_email },
      rep: {
        name:  me.name || me.email,
        email: me.email,
        phone: (me as any).phone || '',
      },
    })
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="preview.pdf"`,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Render failed' }, { status: 500 })
  }
}
