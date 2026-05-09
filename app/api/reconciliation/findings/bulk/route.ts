// PATCH /api/reconciliation/findings/bulk
// Body: { ids: string[], status: 'open' | 'disputed' | 'resolved' | 'ignored' }
// Bulk status update for the findings list. Used by the table's
// select-many bar so accounting can knock out a wave of legacy
// orphans in one click.

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

const ALLOWED_STATUSES = new Set(['open', 'disputed', 'resolved', 'ignored'])

function isAllowed(role: string | null | undefined, isPartner: boolean | null | undefined): boolean {
  return role === 'accounting' || role === 'admin' || role === 'superadmin' || isPartner === true
}

export async function PATCH(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAllowed(me.role as any, (me as any).is_partner)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const status = body?.status
  const rawIds = Array.isArray(body?.ids) ? body.ids : []
  if (!ALLOWED_STATUSES.has(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }
  const ids = (rawIds as any[]).filter((x): x is string => typeof x === 'string' && x.length > 0)
  if (ids.length === 0) return NextResponse.json({ error: 'ids required' }, { status: 400 })

  const patch: Record<string, any> = { status }
  if (status === 'resolved' || status === 'ignored' || status === 'disputed') {
    patch.resolved_by = me.email || '(unknown)'
    patch.resolved_at = new Date().toISOString()
  } else {
    patch.resolved_by = null
    patch.resolved_at = null
  }

  const sb = admin()
  const { data, error } = await sb
    .from('reconciliation_findings')
    .update(patch)
    .in('id', ids)
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, updated: (data || []).length })
}
