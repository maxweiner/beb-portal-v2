// POST /api/expense-reports/[id]/bonus
//
// Partner-only. Sets bonus_amount + bonus_note on an expense report.
// The DB trigger recomputes grand_total. Buyers and regular admins
// cannot call this — partner = users.is_partner = true (only
// Max/Joe/Rich today).

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { blockIfImpersonating } from '@/lib/impersonation/server'

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
  if (!me.is_partner) return NextResponse.json({ error: 'Partners only' }, { status: 403 })

  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  let body: any
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const rawAmount = Number(body?.amount ?? 0)
  if (!Number.isFinite(rawAmount) || rawAmount < 0) {
    return NextResponse.json({ error: 'amount must be a non-negative number' }, { status: 400 })
  }
  const amount = Math.round(rawAmount * 100) / 100
  const rawNote = (body?.note ?? '').toString()
  // Cap at 500 chars; null when empty so the column reads cleanly.
  const note = rawNote.trim().length > 0 ? rawNote.trim().slice(0, 500) : null

  const sb = admin()
  const { data: report, error: rErr } = await sb
    .from('expense_reports')
    .select('id, user_id, status')
    .eq('id', params.id)
    .maybeSingle()
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 })
  if (!report) return NextResponse.json({ error: 'Report not found' }, { status: 404 })
  // Bonuses are for non-partner buyers only — partners (Max/Joe/Rich)
  // never receive a bonus on their own expense reports, regardless of
  // who's granting. UI hides the input on partner-owned reports; this
  // check closes the loop server-side.
  const { data: ownerRow } = await sb
    .from('users').select('is_partner').eq('id', report.user_id).maybeSingle()
  if ((ownerRow as any)?.is_partner) {
    return NextResponse.json({ error: 'Partners cannot receive a bonus on their expense reports.' }, { status: 403 })
  }

  const { data: updated, error: upErr } = await sb
    .from('expense_reports')
    .update({ bonus_amount: amount, bonus_note: note })
    .eq('id', report.id)
    .select('id, bonus_amount, bonus_note, total_expenses, total_compensation, grand_total')
    .single()
  if (upErr || !updated) {
    return NextResponse.json({ error: upErr?.message || 'Update failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, report: updated })
}
