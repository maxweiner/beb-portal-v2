// POST /api/reconciliation/findings/[id]/mark-not-event-check
// Adds the finding's check_number to non_event_check_numbers (the
// allowlist), then deletes the orphan finding. Future imports
// auto-classify the same number as ignored, not orphan.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

function isAllowed(role: string | null | undefined, isPartner: boolean | null | undefined): boolean {
  return role === 'accounting' || role === 'admin' || role === 'superadmin' || isPartner === true
}

export async function POST(req: Request, ctx: { params: { id: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAllowed(me.role as any, (me as any).is_partner)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const id = ctx.params.id
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  let body: any = {}
  try { body = await req.json() } catch {}
  const note = body?.note ? String(body.note) : null

  const sb = admin()
  const { data: finding, error: fErr } = await sb
    .from('reconciliation_findings')
    .select('id, brand, check_number, finding_type')
    .eq('id', id)
    .maybeSingle()
  if (fErr || !finding) {
    return NextResponse.json({ error: fErr?.message || 'Finding not found' }, { status: 404 })
  }
  if (finding.finding_type !== 'orphan_cleared') {
    return NextResponse.json({ error: 'Only orphan findings can be marked as non-event checks' }, { status: 400 })
  }

  const { error: insErr } = await sb
    .from('non_event_check_numbers')
    .upsert(
      {
        brand: finding.brand,
        check_number: finding.check_number,
        marked_by: me.email || '(unknown)',
        note,
      },
      { onConflict: 'brand,check_number', ignoreDuplicates: false },
    )
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  // Drop the now-suppressed orphan finding.
  await sb.from('reconciliation_findings').delete().eq('id', finding.id)

  return NextResponse.json({ ok: true })
}
