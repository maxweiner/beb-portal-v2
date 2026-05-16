// POST /api/admin/trade-show-gcal/backfill
//
// Re-enqueues every live trade show into trade_show_gcal_sync_queue
// so the cron can mirror them all to the org-wide Google Calendar.
// Server-side because the queue table's RLS is read-only for
// admins — direct client INSERTs blow up. Service-role client
// bypasses RLS.
//
// Auth: superadmin only (template / calendar mgmt has historically
// been superadmin-only across the app). Returns the enqueued count.

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

export async function POST(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (me.role !== 'superadmin') {
    return NextResponse.json({ error: 'Superadmin only' }, { status: 403 })
  }

  const sb = admin()

  const { data: shows, error: queryErr } = await sb
    .from('trade_shows')
    .select('id')
    .is('deleted_at', null)
  if (queryErr) {
    return NextResponse.json({ error: `Query failed: ${queryErr.message}` }, { status: 500 })
  }
  const rows = (shows || []).map((s: any) => ({
    trade_show_id: s.id,
    action: 'sync' as const,
  }))
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, enqueued: 0, note: 'No live trade shows found.' })
  }

  const { error: insErr } = await sb.from('trade_show_gcal_sync_queue').insert(rows)
  if (insErr) {
    return NextResponse.json({ error: `Insert failed: ${insErr.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true, enqueued: rows.length })
}
