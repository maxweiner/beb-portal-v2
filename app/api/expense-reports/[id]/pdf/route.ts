// POST /api/expense-reports/[id]/pdf
//
// Regenerates the PDF for a report and returns a 1h signed URL the
// client can open. Auth: must be the report's owner OR admin/superadmin.
// (Partners — distinct from superadmin — get this implicitly via their
// admin/superadmin role today; if a "partner-but-not-admin" user ever
// exists we can extend.)

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser, isAdminLike } from '@/lib/expenses/serverAuth'
import { generateAndStoreReportPdf } from '@/lib/expenses/generatePdf'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = admin()
  const { data: report, error: rErr } = await sb
    .from('expense_reports').select('id, user_id').eq('id', params.id).maybeSingle()
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 })
  if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const isOwner = report.user_id === me.id
  if (!isOwner && !isAdminLike(me)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { signedUrl } = await generateAndStoreReportPdf(params.id)
    return NextResponse.json({ ok: true, url: signedUrl })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'PDF generation failed' }, { status: 500 })
  }
}
