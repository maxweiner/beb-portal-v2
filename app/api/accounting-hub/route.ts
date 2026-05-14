// GET /api/accounting-hub
//
// Lists every expense report awaiting accountant action — both the
// 'submitted_pending_review' (needs approve) bucket and the
// 'approved' (needs payment) bucket. Each row carries the totals,
// receipt count, age in days, and a reference to the buyer's name
// + event so the UI can render the queue without a second call.
//
// Optional query params:
//   ?include_paid=true             — also return 'paid' reports,
//                                     limited to the lookback window
//                                     below (default 90 days). Useful
//                                     for the "Paid (last N days)" or
//                                     "All (incl. paid)" filters on
//                                     the Hub.
//   ?paid_lookback_days=N          — override the 90-day default for
//                                     paid reports. Capped at 365 to
//                                     avoid runaway result sizes.
//
// Auth: caller must hold the `accounting` role OR be admin /
// superadmin / partner.

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

interface QueueRow {
  id: string
  status: 'submitted_pending_review' | 'approved' | 'paid'
  buyer_id: string
  buyer_name: string
  event_id: string | null
  event_label: string | null
  brand: string | null
  submitted_at: string | null
  approved_at: string | null
  /** Payment audit fields. Populated when status='paid'; null
   *  otherwise. paid_note is the free-text 'how it was paid'
   *  string the accountant entered at mark-paid time. */
  paid_at: string | null
  paid_by_user_id: string | null
  paid_by_name: string | null
  paid_note: string | null
  age_days: number          // since submitted (or approved if no submit)
  total_expenses: number
  total_compensation: number
  total_bonus: number
  grand_total: number
  receipt_count: number
  /** Audit fields surfaced to the queue UI for the "Exported ✓"
   *  pill + re-export warning. Null when never exported. */
  report_number: string | null
  exported_to_qb_at: string | null
  exported_to_qb_format: 'iif' | 'csv' | null
}

export async function GET(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = admin()
  const { data: caller } = await sb
    .from('users')
    .select('role, is_partner')
    .eq('id', me.id)
    .maybeSingle()
  const allowed = caller?.role === 'accounting'
    || caller?.role === 'admin'
    || caller?.role === 'superadmin'
    || !!caller?.is_partner
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // ── Optional paid-lookback parsing ─────────────────────────
  const url = new URL(req.url)
  const includePaid = url.searchParams.get('include_paid') === 'true'
  let paidLookbackDays = 90
  const lookbackRaw = url.searchParams.get('paid_lookback_days')
  if (lookbackRaw) {
    const parsed = Number(lookbackRaw)
    if (Number.isFinite(parsed) && parsed > 0) {
      // Cap at one year — anything beyond that is more usefully
      // served by the report-number search / export tooling.
      paidLookbackDays = Math.min(parsed, 365)
    }
  }
  const paidCutoff = new Date(Date.now() - paidLookbackDays * 24 * 60 * 60 * 1000).toISOString()

  // ── Active reports (always returned) ───────────────────────
  // Deliberately ONE join to users (the submitter / owner). An
  // earlier attempt added `paid_by_user:users!paid_by(name)` here
  // to surface the AP user on paid rows in the same trip — but
  // PostgREST silently drops rows when a query has TWO foreign
  // keys to the same target table and one is NULL (paid_by is
  // null on every never-paid row). That broke the listing for
  // newly-unmarked-paid reports specifically (Alan's report,
  // 2026-05-14). Switching to a separate fetch for paid_by names
  // below restores the original 1:1 join semantics here.
  const { data: activeReports, error } = await sb
    .from('expense_reports')
    .select(`
      id, status, user_id, event_id,
      submitted_at, approved_at, paid_at, paid_by, paid_note,
      total_expenses, total_compensation, bonus_amount, grand_total,
      report_number, exported_to_qb_at, exported_to_qb_format,
      user:users!user_id(name),
      event:events(store_name, start_date, brand)
    `)
    .in('status', ['submitted_pending_review', 'approved'])
    .order('submitted_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // ── Paid reports (opt-in via ?include_paid=true) ───────────
  // Same single-users-join shape as active. paid_by_name is
  // hydrated in the merge step below.
  let paidReports: any[] = []
  if (includePaid) {
    const { data, error: paidErr } = await sb
      .from('expense_reports')
      .select(`
        id, status, user_id, event_id,
        submitted_at, approved_at, paid_at, paid_by, paid_note,
        total_expenses, total_compensation, bonus_amount, grand_total,
        report_number, exported_to_qb_at, exported_to_qb_format,
        user:users!user_id(name),
        event:events(store_name, start_date, brand)
      `)
      .eq('status', 'paid')
      .gte('paid_at', paidCutoff)
      .order('paid_at', { ascending: false })
    if (paidErr) return NextResponse.json({ error: paidErr.message }, { status: 500 })
    paidReports = data || []
  }

  const reports = [...(activeReports || []), ...paidReports]

  // ── paid_by user names — separate fetch ─────────────────────
  // Only the paid rows have paid_by set, so the lookup is bounded
  // (typically <100 rows in a 90-day window). One trip per render
  // is cheap.
  const paidByIds = Array.from(new Set(
    (reports || []).map(r => (r as any).paid_by).filter(Boolean) as string[],
  ))
  const paidByNameById = new Map<string, string>()
  if (paidByIds.length > 0) {
    const { data: payers } = await sb
      .from('users')
      .select('id, name')
      .in('id', paidByIds)
    for (const u of (payers || []) as any[]) {
      if (u.id && u.name) paidByNameById.set(u.id, u.name)
    }
  }

  // Receipt counts per report — single roundtrip with .in().
  const ids = (reports || []).map(r => r.id)
  const receiptCount = new Map<string, number>()
  if (ids.length > 0) {
    const { data: exps } = await sb
      .from('expenses')
      .select('report_id, receipt_url')
      .in('report_id', ids)
      .not('receipt_url', 'is', null)
    for (const e of (exps || [])) {
      const rid = (e as any).report_id as string
      receiptCount.set(rid, (receiptCount.get(rid) || 0) + 1)
    }
  }

  const today = Date.now()
  const rows: QueueRow[] = (reports || []).map((r: any) => {
    // For paid rows, age tracks days-since-paid so the UI can sort
    // "most recently paid first" without a second pass. For active
    // rows, it's days-since-submitted (the bucket the accountant
    // cares about — how long has this been waiting).
    const stamp = r.status === 'paid'
      ? (r.paid_at || r.submitted_at || r.approved_at)
      : (r.submitted_at || r.approved_at)
    const age = stamp ? Math.floor((today - new Date(stamp).getTime()) / 86400000) : 0
    const ev = r.event
    const evLabel = ev ? `${ev.store_name}${ev.start_date ? ' · ' + ev.start_date : ''}` : null
    return {
      id: r.id,
      status: r.status,
      buyer_id: r.user_id,
      buyer_name: r.user?.name || '(unknown)',
      event_id: r.event_id,
      event_label: evLabel,
      brand: ev?.brand ?? null,
      submitted_at: r.submitted_at,
      approved_at: r.approved_at,
      paid_at: r.paid_at || null,
      paid_by_user_id: r.paid_by || null,
      paid_by_name: r.paid_by ? (paidByNameById.get(r.paid_by) || null) : null,
      paid_note: r.paid_note || null,
      age_days: age,
      total_expenses: Number(r.total_expenses) || 0,
      total_compensation: Number(r.total_compensation) || 0,
      total_bonus: Number(r.bonus_amount) || 0,
      grand_total: Number(r.grand_total) || 0,
      receipt_count: receiptCount.get(r.id) || 0,
      report_number: r.report_number || null,
      exported_to_qb_at: r.exported_to_qb_at || null,
      exported_to_qb_format: r.exported_to_qb_format || null,
    }
  })

  return NextResponse.json({ rows, paid_lookback_days: includePaid ? paidLookbackDays : null })
}
