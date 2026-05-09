// GET /api/accounting-queue
//
// Lists every expense report awaiting accountant action — both the
// 'submitted_pending_review' (needs approve) bucket and the
// 'approved' (needs payment) bucket. Each row carries the totals,
// receipt count, age in days, and a reference to the buyer's name
// + event so the UI can render the queue without a second call.
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
  status: 'submitted_pending_review' | 'approved'
  buyer_id: string
  buyer_name: string
  event_id: string | null
  event_label: string | null
  brand: string | null
  submitted_at: string | null
  approved_at: string | null
  age_days: number          // since submitted (or approved if no submit)
  total_expenses: number
  total_compensation: number
  total_bonus: number
  grand_total: number
  receipt_count: number
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

  // Pull all reports in the two relevant statuses.
  const { data: reports, error } = await sb
    .from('expense_reports')
    .select(`
      id, status, user_id, event_id, brand,
      submitted_at, approved_at,
      total_expenses, total_compensation, bonus_amount, grand_total,
      user:users!user_id(name),
      event:events(store_name, start_date)
    `)
    .in('status', ['submitted_pending_review', 'approved'])
    .order('submitted_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

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
    const stamp = r.submitted_at || r.approved_at
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
      brand: r.brand,
      submitted_at: r.submitted_at,
      approved_at: r.approved_at,
      age_days: age,
      total_expenses: Number(r.total_expenses) || 0,
      total_compensation: Number(r.total_compensation) || 0,
      total_bonus: Number(r.bonus_amount) || 0,
      grand_total: Number(r.grand_total) || 0,
      receipt_count: receiptCount.get(r.id) || 0,
    }
  })

  return NextResponse.json({ rows })
}
