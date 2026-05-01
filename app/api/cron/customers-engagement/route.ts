// Daily cron: recompute engagement_tier for every non-deleted
// customer using the SQL function shipped in
// supabase-migration-customers-phase-4-engagement-fn.sql.
//
// Reads thresholds from the settings table (admin-configurable via
// the Tags & Engagement tab). Falls back to spec defaults.
//
// Auth: ?secret=<CRON_SECRET> matches the existing cron route
// convention (vercel.json query string).

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

const DEFAULTS = { active_days: 365, lapsed_days: 730, vip_threshold: 5 }

async function loadInt(sb: ReturnType<typeof admin>, key: string, fallback: number): Promise<number> {
  const { data } = await sb.from('settings').select('value').eq('key', key).maybeSingle()
  if (!data) return fallback
  // settings.value is JSONB. Accept bare number, JSON-stringified number, or quoted string.
  const v = (data as any).value
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const n = parseInt(v.replace(/^"|"$/g, ''), 10)
    return Number.isFinite(n) && n > 0 ? n : fallback
  }
  return fallback
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const secret = url.searchParams.get('secret') || ''
  const expected = process.env.CRON_SECRET || 'bebportal2024'
  if (secret !== expected) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = admin()
  const [activeDays, lapsedDays, vipThreshold] = await Promise.all([
    loadInt(sb, 'customers.engagement.active_days',   DEFAULTS.active_days),
    loadInt(sb, 'customers.engagement.lapsed_days',   DEFAULTS.lapsed_days),
    loadInt(sb, 'customers.engagement.vip_threshold', DEFAULTS.vip_threshold),
  ])

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
    ran_at: new Date().toISOString(),
  })
}
