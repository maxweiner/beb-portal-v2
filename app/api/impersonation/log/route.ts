// GET /api/impersonation/log
//
// Returns the caller's impersonation history (impersonation_log
// rows) ordered newest-first. Hardcoded to max@bebllp.com — this
// is Max's own audit trail. Joins the target user's name/email so
// the UI doesn't have to rehydrate.

import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { adminClient, isImpersonator } from '@/lib/impersonation/server'

export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 100

export async function GET(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isImpersonator(me)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get('limit') || `${DEFAULT_LIMIT}`, 10) || DEFAULT_LIMIT, 1),
    500,
  )

  const sb = adminClient()
  const { data: rows, error } = await sb
    .from('impersonation_log')
    .select('id, target_id, started_at, ended_at, ip_address')
    .eq('actor_id', me.id)
    .order('started_at', { ascending: false })
    .limit(limit)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const targetIds = Array.from(new Set((rows || []).map(r => r.target_id)))
  const { data: targets } = targetIds.length
    ? await sb.from('users').select('id, name, email, role').in('id', targetIds)
    : { data: [] as any[] }
  const byId = new Map((targets || []).map((u: any) => [u.id, u]))

  return NextResponse.json({
    entries: (rows || []).map(r => ({
      id: r.id,
      target: byId.get(r.target_id) || { id: r.target_id, name: '(deleted user)', email: '', role: '' },
      startedAt: r.started_at,
      endedAt: r.ended_at,
      ipAddress: r.ip_address,
    })),
  })
}
