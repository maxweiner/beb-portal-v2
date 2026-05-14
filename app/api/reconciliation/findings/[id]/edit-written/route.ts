// PATCH /api/reconciliation/findings/[id]/edit-written
//
// Inline-edit a buyer_checks row (or an event_days store-commission
// check) tied to a reconciliation finding. Used when the user spots
// an entry-time typo on the reconciliation page and wants to fix it
// without navigating to Day Entry — handy for day-less rows that
// the Day Entry filter hides.
//
// Body: {
//   source_table:     'buyer_checks' | 'event_days',
//   source_id:        string,
//   new_amount?:      number   // positive; optional if changing only the check #
//   new_check_number?: string  // optional if changing only the amount
// }
//
// At least one of new_amount / new_check_number must be provided.
// Changing the check_number lets you fix a "wrong number written on
// the wrong check" typo — the source row will fall off the current
// finding (whose check_number no longer matches) and either match a
// different finding cleanly or disappear if no cleared check of
// that number is left short.
//
// On success, re-runs the matcher for the finding's brand so any
// findings reclassify (e.g. mismatch → matched) on next reload.

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
  if (!ALLOWED_TABLES.has(sourceTable)) {
    return NextResponse.json({ error: 'source_table must be buyer_checks or event_days' }, { status: 400 })
  }
  if (!sourceId) return NextResponse.json({ error: 'source_id required' }, { status: 400 })

  // ── Parse optional new_amount / new_check_number ────────────
  let newAmount: number | null = null
  if (body?.new_amount !== undefined && body?.new_amount !== null && body?.new_amount !== '') {
    const n = Number(body.new_amount)
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: 'new_amount must be a non-negative number' }, { status: 400 })
    }
    newAmount = n
  }

  let newCheckNumber: string | null = null
  if (body?.new_check_number !== undefined && body?.new_check_number !== null) {
    const trimmed = String(body.new_check_number).trim()
    // Allow alphanumeric + dashes (some pads use 'CK-1234'); cap at 50.
    if (trimmed.length === 0) {
      return NextResponse.json({ error: 'new_check_number cannot be empty' }, { status: 400 })
    }
    if (trimmed.length > 50) {
      return NextResponse.json({ error: 'new_check_number too long (max 50)' }, { status: 400 })
    }
    newCheckNumber = trimmed
  }

  if (newAmount === null && newCheckNumber === null) {
    return NextResponse.json({ error: 'At least one of new_amount or new_check_number is required' }, { status: 400 })
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

  // Build the per-table patch — column names differ between
  // buyer_checks (amount, check_number) and event_days
  // (store_commission_check_amount, store_commission_check_number).
  let updErr: { message: string } | null = null
  if (sourceTable === 'buyer_checks') {
    const patch: Record<string, unknown> = {}
    if (newAmount !== null)      patch.amount       = newAmount
    if (newCheckNumber !== null) patch.check_number = newCheckNumber
    const { error } = await sb.from('buyer_checks').update(patch).eq('id', sourceId)
    updErr = error
  } else {
    const patch: Record<string, unknown> = {}
    if (newAmount !== null)      patch.store_commission_check_amount = newAmount
    if (newCheckNumber !== null) patch.store_commission_check_number = newCheckNumber
    const { error } = await sb.from('event_days').update(patch).eq('id', sourceId)
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
