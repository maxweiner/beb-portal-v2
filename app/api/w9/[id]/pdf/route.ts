// GET /api/w9/[id]/pdf
//
// Returns the signed W-9 PDF inline. Access gate:
//   - the recipient (`recipient_user_id = me`), OR
//   - admin / superadmin / partner / accounting
//
// Streams from the private storage bucket via a fresh signed URL.

import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { pdfAdmin } from '@/lib/wholesale/pdfHelpers'

export const dynamic = 'force-dynamic'

const W9_BUCKET = 'wholesale-documents'

export async function GET(req: Request, ctx: { params: { id: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = pdfAdmin()
  const { data: w9, error } = await sb.from('w9_requests')
    .select('id, recipient_user_id, signed_pdf_path, recipient_name')
    .eq('id', ctx.params.id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!w9 || !w9.signed_pdf_path) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Access: recipient, OR accountant-level role.
  const isRecipient = w9.recipient_user_id === me.id
  const isStaff = me.role === 'admin' || me.role === 'superadmin' || me.role === 'accounting' || (me as any).is_partner === true
  if (!isRecipient && !isStaff) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Pull the PDF bytes and return them inline.
  const { data: file, error: dlErr } = await sb.storage.from(W9_BUCKET).download(w9.signed_pdf_path)
  if (dlErr || !file) return NextResponse.json({ error: dlErr?.message || 'Download failed' }, { status: 500 })
  const buf = Buffer.from(await file.arrayBuffer())

  const filename = (w9.signed_pdf_path.split('/').pop() || 'W9.pdf')

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
