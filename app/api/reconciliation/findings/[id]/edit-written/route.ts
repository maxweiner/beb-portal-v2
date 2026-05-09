// PATCH /api/reconciliation/findings/[id]/edit-written
//
// Inline-edit the written amount on a buyer_checks row (or an
// event_days store-commission check) tied to a reconciliation
// finding. Used when the user spots an entry-time typo on the
// reconciliation page and wants to fix it without navigating to
// Day Entry.
//
// Body: {
//   source_table: 'buyer_checks' | 'event_days',
//   source_id:    string,
//   new_amount:   number          // positive
// }
//
// On success, also re-runs the matcher for the finding's brand so
// the finding reclassifies (e.g. mismatch → matched) on the next
// page reload.

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

const ALLOWED_TABLES = new Set(['buyer_checks', 'event_days'])

export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAllowed(me.role as any, (me as any).is_partner)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const findingId = ctx.params.id
  if (!findingId) return NextResponse.json({ error: 'finding id required' }, { status: 400 })

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const sourceTable = String(body?.source_table || '')
  const sourceId    = String(body?.source_id || '')
  const newAmount   = Number(body?.new_amount)
  if (!ALLOWED_TABLES.has(sourceTable)) {
    return NextResponse.json({ error: 'source_table must be buyer_checks or event_days' }, { status: 400 })
  }
  if (!sourceId) return NextResponse.json({ error: 'source_id required' }, { status: 400 })
  if (!Number.isFinite(newAmount) || newAmount < 0) {
    return NextResponse.json({ error: 'new_amount must be a non-negative number' }, { status: 400 })
  }

  const sb = admin()

  // Pull the finding so we know which brand to re-run the matcher for.
  const { data: finding, error: fErr } = await sb
    .from('reconciliation_findings')
    .select('id, brand, check_number')
    .eq('id', findingId)
    .maybeSingle()
  if (fErr || !finding) {
    return NextResponse.json({ error: fErr?.message || 'Finding not found' }, { status: 404 })
  }

  // Apply the update to the right table. Both columns are NUMERIC.
  let updErr: { message: string } | null = null
  if (sourceTable === 'buyer_checks') {
    const { error } = await sb
      .from('buyer_checks')
      .update({ amount: newAmount })
      .eq('id', sourceId)
    updErr = error
  } else {
    // event_days commission column
    const { error } = await sb
      .from('event_days')
      .update({ store_commission_check_amount: newAmount })
      .eq('id', sourceId)
    updErr = error
  }
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  // Re-run matcher so the finding reclassifies. We don't fail the
  // request if the matcher errors — the underlying ledger is already
  // fixed, the user can hit Re-run matching manually.
  const { error: matchErr } = await sb.rpc('reconciliation_run_match', { p_brand: finding.brand })

  return NextResponse.json({
    ok: true,
    match_error: matchErr?.message || null,
  })
}
