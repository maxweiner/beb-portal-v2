// PATCH /api/reconciliation/findings/[id]
// Update status + note on a finding. Sets resolved_by/_at when status
// transitions to a terminal state.

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

export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAllowed(me.role as any, (me as any).is_partner)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const id = ctx.params.id
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const patch: Record<string, any> = {}
  if (typeof body.status === 'string') {
    if (!ALLOWED_STATUSES.has(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    patch.status = body.status
    if (body.status === 'resolved' || body.status === 'ignored' || body.status === 'disputed') {
      patch.resolved_by = me.email || '(unknown)'
      patch.resolved_at = new Date().toISOString()
    } else {
      // back to open
      patch.resolved_by = null
      patch.resolved_at = null
    }
  }
  if (body.note !== undefined) {
    patch.note = body.note ? String(body.note) : null
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No updatable fields' }, { status: 400 })
  }

  const sb = admin()
  // .maybeSingle() instead of .single() so a no-rows-matched
  // UPDATE returns null instead of the cryptic PostgREST
  // 'Cannot coerce the result to a single JSON object' error.
  // No-rows-matched happens when the finding row was deleted
  // out from under the open modal — typically by a re-import
  // (reconciliation_findings is rebuilt on each fresh import).
  // The maybeSingle path lets us return a clean 404 instead.
  const { data, error } = await sb
    .from('reconciliation_findings')
    .update(patch)
    .eq('id', id)
    .select('*')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) {
    return NextResponse.json({
      error: 'Finding no longer exists. It may have been removed by a re-import — refresh the page to see the current list.',
    }, { status: 404 })
  }
  return NextResponse.json({ ok: true, finding: data })
}
