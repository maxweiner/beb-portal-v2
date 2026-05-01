// POST /api/customers/recompute-engagement
//
// Admin-triggered manual recompute. Reads thresholds from the
// settings table and calls the same RPC the daily cron uses.
// Body: optional override thresholds for one-off "what-if" runs.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser, isAdminLike } from '@/lib/expenses/serverAuth'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

async function loadInt(sb: ReturnType<typeof admin>, key: string, fallback: number): Promise<number> {
  const { data } = await sb.from('settings').select('value').eq('key', key).maybeSingle()
  if (!data) return fallback
  const v = (data as any).value
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const n = parseInt(v.replace(/^"|"$/g, ''), 10)
    return Number.isFinite(n) && n > 0 ? n : fallback
  }
  return fallback
}

export async function POST(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdminLike(me)) return NextResponse.json({ error: 'Admin required' }, { status: 403 })

  let body: any = {}
  try { body = await req.json() } catch { /* empty body OK */ }

  const sb = admin()
  const activeDays   = body?.active_days   ?? await loadInt(sb, 'customers.engagement.active_days',   365)
  const lapsedDays   = body?.lapsed_days   ?? await loadInt(sb, 'customers.engagement.lapsed_days',   730)
  const vipThreshold = body?.vip_threshold ?? await loadInt(sb, 'customers.engagement.vip_threshold', 5)

  const { data, error } = await sb.rpc('customers_recompute_engagement', {
    p_active_days: activeDays,
    p_lapsed_days: lapsedDays,
    p_vip_threshold: vipThreshold,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    ok: true,
    rows_updated: data,
    thresholds: { active_days: activeDays, lapsed_days: lapsedDays, vip_threshold: vipThreshold },
  })
}
