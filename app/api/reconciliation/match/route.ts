// POST /api/reconciliation/match
// Body: { brand: 'beb' | 'liberty' }
// Re-runs the matcher and returns the summary counts. Triggered by
// the "Re-run matching" button on the page.

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

export async function POST(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAllowed(me.role as any, (me as any).is_partner)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  let body: any = {}
  try { body = await req.json() } catch {}
  const brand = body?.brand
  if (brand !== 'beb' && brand !== 'liberty') {
    return NextResponse.json({ error: 'brand must be "beb" or "liberty"' }, { status: 400 })
  }
  const sb = admin()
  const { data, error } = await sb.rpc('reconciliation_run_match', { p_brand: brand })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, summary: data })
}
