// GET /api/communications/sends/[id]/pdf-url
//
// Returns a short-lived signed URL for the rendered PDF stored
// at communications/{id}.pdf in the private communication-pdfs
// bucket. Used by the per-trunk-show Communications section's
// "View PDF" link.
//
// Auth: admin / superadmin / partner OR sales_rep assigned to
// that trunk show. Mirrors the send endpoint's gate.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { signLetterPdf } from '@/lib/communications/generatePdf'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = admin()
  const { data: row } = await sb
    .from('communication_sends')
    .select('id, trunk_show_id, pdf_url, trunk_shows(assigned_rep_id)')
    .eq('id', params.id)
    .maybeSingle()

  if (!row) return NextResponse.json({ error: 'Send not found' }, { status: 404 })
  if (!row.pdf_url) return NextResponse.json({ error: 'No PDF on file for this send' }, { status: 404 })

  const isAdmin = me.role === 'admin' || me.role === 'superadmin' || !!me.is_partner
  const ts = row.trunk_shows as any
  const assignedRepId = Array.isArray(ts) ? ts[0]?.assigned_rep_id : ts?.assigned_rep_id
  if (!isAdmin && assignedRepId !== me.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const url = await signLetterPdf(sb, row.pdf_url, 60 * 60)
    return NextResponse.json({ url })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Sign failed' }, { status: 500 })
  }
}
