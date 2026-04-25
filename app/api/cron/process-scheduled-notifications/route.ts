// Cron worker for the v2 notification system. Runs every minute via
// Vercel Cron and processes due rows from scheduled_notifications.
//
// Auth: ?secret=<CRON_SECRET> matching the same pattern as the other
// cron routes in vercel.json.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { dispatchOne } from '@/lib/notifications/dispatcher'

export const dynamic = 'force-dynamic'

const BATCH_SIZE = 25

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

async function run(req: Request) {
  const url = new URL(req.url)
  const secret = url.searchParams.get('secret')
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = admin()

  // claim_due_notifications atomically marks the batch as 'processing'
  // and returns them. Concurrent workers see different rows thanks to
  // FOR UPDATE SKIP LOCKED inside the function.
  const { data: claimed, error } = await sb.rpc('claim_due_notifications', { batch_size: BATCH_SIZE })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  const rows = (claimed || []) as any[]
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, claimed: 0 })
  }

  const results: any[] = []
  for (const row of rows) {
    try {
      const r = await dispatchOne(row)
      results.push(r)
    } catch (e: any) {
      console.error('[notif-cron] dispatch error for row', row.id, e)
      // Put it back in pending so we retry next cycle. If this keeps
      // happening, the dispatcher's own retry logic will eventually
      // mark it failed.
      await sb.from('scheduled_notifications')
        .update({
          status: 'pending',
          error_message: `dispatcher_crash: ${e?.message || 'unknown'}`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
      results.push({ rowId: row.id, outcome: 'crashed', error: e?.message })
    }
  }

  const summary = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.outcome] = (acc[r.outcome] || 0) + 1
    return acc
  }, {})

  return NextResponse.json({ ok: true, claimed: rows.length, summary, results })
}

export async function POST(req: Request) { return run(req) }
export async function GET(req: Request) { return run(req) }
