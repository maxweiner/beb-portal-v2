// GET / PATCH /api/white-sheets/settings
//
// GET → returns:
//   - toggle: per-brand `review_every_page` map (current state)
//   - stats: per-brand last-30-day rollup
//       { uploads, pages_total, auto_commit_rate, avg_cost_cents,
//         pages_in_review, pages_errored }
//
// PATCH → updates the per-brand toggle. Body:
//   { brand: 'beb' | 'liberty', value: true | false }
//
// Auth: bearer token + role check. Toggle write is admin /
// superadmin / partner only; GET is open to any internal active
// user so a buyer can see the current toggle state without
// granting them write access.
//
// No new schema — the settings row already exists from Phase 1
// at key='white_sheets.review_every_page'.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { blockIfImpersonating } from '@/lib/impersonation/server'

export const dynamic = 'force-dynamic'

const BLOCKED_ROLES = new Set(['pending', 'marketing_partner'])
const WRITE_ROLES   = new Set(['admin', 'superadmin', 'accounting'])

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

async function authedUser(req: Request) {
  const authHeader = req.headers.get('authorization') || ''
  const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!accessToken) return { error: 'auth_required' as const, status: 401 }

  const sb = admin()
  const userClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${accessToken}` } } },
  )
  const { data: userResp } = await userClient.auth.getUser()
  const authUid = userResp?.user?.id
  if (!authUid) return { error: 'auth_invalid' as const, status: 401 }

  const { data: userRow } = await sb
    .from('users')
    .select('id, role, is_partner')
    .eq('auth_id', authUid)
    .maybeSingle()
  if (!userRow) return { error: 'user_not_found' as const, status: 401 }
  if (BLOCKED_ROLES.has((userRow as any).role)) {
    return { error: 'role_not_allowed' as const, status: 403 }
  }
  return { userRow: userRow as any }
}

// ─────────────────────────────────────────────────────────────
// GET — toggle state + 30-day stats per brand
// ─────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const auth = await authedUser(req)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const sb = admin()

  // ── Toggle state ───────────────────────────────────────────
  const { data: toggleRow } = await sb
    .from('settings')
    .select('value')
    .eq('key', 'white_sheets.review_every_page')
    .maybeSingle()
  const toggle = ((toggleRow as any)?.value || {}) as Record<string, boolean>

  // ── 30-day stats — one round trip per brand ─────────────────
  // Pull recent uploads, fold in JS. Dataset is small (~10-50
  // uploads/month/brand) so aggregating client-side keeps the
  // SQL simple — no need for a view or RPC.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { data: uploads } = await sb
    .from('white_sheet_uploads')
    .select(`
      id, brand, status,
      pages_total, pages_auto_committed, pages_in_review, pages_errored,
      estimated_cost_cents, created_at, completed_at
    `)
    .gte('created_at', thirtyDaysAgo)

  type Bucket = {
    uploads: number
    completed_uploads: number
    pages_total: number
    pages_auto_committed: number
    pages_in_review: number
    pages_errored: number
    cost_cents_total: number
  }
  const empty = (): Bucket => ({
    uploads: 0, completed_uploads: 0,
    pages_total: 0, pages_auto_committed: 0, pages_in_review: 0, pages_errored: 0,
    cost_cents_total: 0,
  })
  const byBrand: Record<string, Bucket> = { beb: empty(), liberty: empty() }
  for (const u of (uploads || []) as any[]) {
    const b = byBrand[u.brand] ?? (byBrand[u.brand] = empty())
    b.uploads += 1
    if (u.status === 'complete') b.completed_uploads += 1
    b.pages_total          += u.pages_total          || 0
    b.pages_auto_committed += u.pages_auto_committed || 0
    b.pages_in_review      += u.pages_in_review      || 0
    b.pages_errored        += u.pages_errored        || 0
    b.cost_cents_total     += u.estimated_cost_cents || 0
  }

  const stats: Record<string, {
    uploads: number
    completed_uploads: number
    pages_total: number
    pages_auto_committed: number
    pages_in_review: number
    pages_errored: number
    auto_commit_rate: number | null  // 0..1; null when pages_total=0
    avg_cost_cents: number | null    // null when uploads=0
    total_cost_cents: number
  }> = {}
  for (const [brand, b] of Object.entries(byBrand)) {
    stats[brand] = {
      uploads: b.uploads,
      completed_uploads: b.completed_uploads,
      pages_total: b.pages_total,
      pages_auto_committed: b.pages_auto_committed,
      pages_in_review: b.pages_in_review,
      pages_errored: b.pages_errored,
      auto_commit_rate: b.pages_total > 0
        ? b.pages_auto_committed / b.pages_total
        : null,
      avg_cost_cents: b.uploads > 0
        ? Math.round(b.cost_cents_total / b.uploads)
        : null,
      total_cost_cents: b.cost_cents_total,
    }
  }

  return NextResponse.json({
    ok: true,
    toggle,
    stats,
    window_days: 30,
  })
}

// ─────────────────────────────────────────────────────────────
// PATCH — toggle update
// ─────────────────────────────────────────────────────────────
export async function PATCH(req: Request) {
  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  const auth = await authedUser(req)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const isPartner  = !!(auth.userRow as any).is_partner
  const isPrivileged = WRITE_ROLES.has((auth.userRow as any).role) || isPartner
  if (!isPrivileged) {
    return NextResponse.json({ error: 'role_not_allowed_for_write' }, { status: 403 })
  }

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }
  const { brand, value } = body || {}
  if (brand !== 'beb' && brand !== 'liberty') {
    return NextResponse.json({ error: 'brand_must_be_beb_or_liberty' }, { status: 400 })
  }
  if (typeof value !== 'boolean') {
    return NextResponse.json({ error: 'value_must_be_boolean' }, { status: 400 })
  }

  const sb = admin()

  // Read-modify-write the JSONB blob. Settings table uses a
  // single row per key; we PATCH one field of the value object.
  const { data: row } = await sb
    .from('settings')
    .select('value')
    .eq('key', 'white_sheets.review_every_page')
    .maybeSingle()
  const current = ((row as any)?.value || {}) as Record<string, boolean>
  const next = { ...current, [brand]: value }

  const { error: updErr } = await sb
    .from('settings')
    .upsert(
      { key: 'white_sheets.review_every_page', value: next },
      { onConflict: 'key' },
    )
  if (updErr) {
    return NextResponse.json({ error: 'update_failed', detail: updErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, toggle: next })
}
