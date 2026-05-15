// POST /api/expense-reports/[id]/payments
// GET  /api/expense-reports/[id]/payments
//
// POST records a new payment on a report:
//   Body: {
//     amount:           number     // dollars; > 0
//     payment_method:   string     // 'check' / 'zelle' / 'wire' / 'ach' /
//                                  // or a custom label saved via the
//                                  // modal's "+ Add New"
//     reference_note?:  string     // "Check #1234" / "Wire 5/14" etc.
//     paid_at?:         ISO string // defaults to now
//     add_method_to_settings?: boolean
//                                  // when true + payment_method is not
//                                  // in the existing settings list, the
//                                  // route appends it so the dropdown
//                                  // remembers next time
//   }
//
// The trigger on expense_report_payments handles the status flip
// (approved → partially_paid → paid) and the amount_paid_cached
// recompute, so the route just writes one row.
//
// GET returns the ledger for the report (newest payment first).
//
// Auth: report owner / delegate is NOT enough — only accounting /
// admin / superadmin / partner can record or list payments. (The
// owner can see the totals via the existing expense-reports GET.)

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { blockIfImpersonating } from '@/lib/impersonation/server'

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = new Set(['accounting', 'admin', 'superadmin'])

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

function isAllowed(me: any): boolean {
  return ALLOWED_ROLES.has(me?.role) || !!me?.is_partner
}

/** Lowercase + trim + collapse whitespace. Used to canonicalize
 *  payment_method strings before comparing against the settings
 *  list. Means 'Check', 'check', and ' Check ' all match. */
function canonicalizeMethod(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ')
}

// ─────────────────────────────────────────────────────────────
// POST — record a payment
// ─────────────────────────────────────────────────────────────
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAllowed(me)) return NextResponse.json({ error: 'Accounting / admin / partner only' }, { status: 403 })

  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const amount = Number(body?.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 })
  }
  // Round to cents — Postgres column is NUMERIC(12,2) but a stray
  // 3+-decimal value would round odd; do it explicitly.
  const cleanAmount = Math.round(amount * 100) / 100

  const methodRaw = typeof body?.payment_method === 'string' ? body.payment_method : ''
  const method = canonicalizeMethod(methodRaw)
  if (!method || method.length > 50) {
    return NextResponse.json({ error: 'payment_method required (1-50 chars)' }, { status: 400 })
  }

  let note: string | null = null
  if (typeof body?.reference_note === 'string') {
    const trimmed = body.reference_note.trim().slice(0, 500)
    note = trimmed.length > 0 ? trimmed : null
  }

  let paidAt: string | null = null
  if (typeof body?.paid_at === 'string') {
    const d = new Date(body.paid_at)
    if (!Number.isNaN(d.getTime())) paidAt = d.toISOString()
  }

  const sb = admin()

  // Verify the report exists + is in a payable state. Triggers
  // would silently allow payments on weird statuses; we reject up
  // front so the UI sees a clear error.
  const { data: report } = await sb
    .from('expense_reports')
    .select('id, status, grand_total')
    .eq('id', params.id)
    .maybeSingle()
  if (!report) return NextResponse.json({ error: 'Report not found' }, { status: 404 })
  if (!['approved', 'partially_paid', 'paid'].includes((report as any).status)) {
    return NextResponse.json(
      { error: `Report is ${(report as any).status}, not approved` },
      { status: 409 },
    )
  }

  // Insert the payment. Trigger recomputes amount_paid_cached +
  // status; no manual sync needed.
  const insertPayload: Record<string, any> = {
    expense_report_id: params.id,
    amount: cleanAmount,
    payment_method: method,
    reference_note: note,
    paid_by: me.id,
  }
  if (paidAt) insertPayload.paid_at = paidAt

  const { data: inserted, error: insErr } = await sb
    .from('expense_report_payments')
    .insert(insertPayload)
    .select('*')
    .single()
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  // Append the method to the settings list when requested + new.
  if (body?.add_method_to_settings === true) {
    await ensureMethodInSettings(sb, method)
  }

  // Return the fresh report state so the UI can update without a
  // second round-trip.
  const { data: refreshed } = await sb
    .from('expense_reports')
    .select('id, status, amount_paid_cached, grand_total')
    .eq('id', params.id)
    .maybeSingle()

  return NextResponse.json({
    ok: true,
    payment: inserted,
    report: refreshed,
  })
}

// ─────────────────────────────────────────────────────────────
// GET — list payments for a report (newest first)
// ─────────────────────────────────────────────────────────────
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAllowed(me)) return NextResponse.json({ error: 'Accounting / admin / partner only' }, { status: 403 })

  const sb = admin()
  const { data, error } = await sb
    .from('expense_report_payments')
    .select(`
      id, expense_report_id, amount, paid_at, payment_method,
      reference_note, paid_by, created_at, deleted_at,
      paid_by_user:users!paid_by(name)
    `)
    .eq('expense_report_id', params.id)
    .is('deleted_at', null)
    .order('paid_at', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    ok: true,
    payments: (data || []).map((p: any) => ({
      id: p.id,
      expense_report_id: p.expense_report_id,
      amount: Number(p.amount),
      paid_at: p.paid_at,
      payment_method: p.payment_method,
      reference_note: p.reference_note,
      paid_by_user_id: p.paid_by,
      paid_by_name: p.paid_by_user?.name || null,
      created_at: p.created_at,
    })),
  })
}

// ─────────────────────────────────────────────────────────────
// Helper — append method to the settings dropdown list
// ─────────────────────────────────────────────────────────────
async function ensureMethodInSettings(sb: ReturnType<typeof admin>, canonical: string) {
  const { data: row } = await sb
    .from('settings')
    .select('value')
    .eq('key', 'expense_payment_methods')
    .maybeSingle()
  const current = Array.isArray((row as any)?.value) ? (row as any).value as string[] : []
  if (current.includes(canonical)) return  // already present
  const next = [...current, canonical]
  await sb
    .from('settings')
    .upsert({ key: 'expense_payment_methods', value: next }, { onConflict: 'key' })
}
