// Daily cron: promote past buying events to status='completed' when
// they have 3 event_days of entered data. The DB function
// events_promote_completed() (see
// supabase-migration-event-status-completed-2-backfill.sql) does
// the heavy lifting; this route just calls it and reports the count.
//
// Auth: ?secret=<CRON_SECRET> matches the rest of /api/cron/*.

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

export async function GET(req: Request) {
  const url = new URL(req.url)
  const secret = url.searchParams.get('secret') || ''
  const expected = process.env.CRON_SECRET || 'bebportal2024'
  if (secret !== expected) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = admin()
  const { data, error } = await sb.rpc('events_promote_completed')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, rows_promoted: data ?? 0 })
}
