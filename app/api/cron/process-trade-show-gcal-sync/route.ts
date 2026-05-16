// Vercel cron worker — trade-show Google Calendar sync.
//
// Runs every minute. Drains up to N pending rows per tick by
// claiming them atomically via claim_due_trade_show_syncs (a
// SECURITY DEFINER RPC using FOR UPDATE SKIP LOCKED — mirrors the
// trunk-show + buying-event sync pattern).
//
// Each claimed row goes through dispatchOneTradeShowSync which
// handles create / patch / delete against the single org-wide
// calendar configured in trade_show_gcal_settings.

import { NextResponse } from 'next/server'
import { dispatchOneTradeShowSync } from '@/lib/gcal/tradeShowDispatcher'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

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
  const { data: claimedRaw, error } = await sb
    .rpc('claim_due_trade_show_syncs', { batch_size: BATCH_SIZE })
  if (error) {
    return NextResponse.json({ error: 'claim_failed', detail: error.message }, { status: 500 })
  }
  const claimed = (claimedRaw || []) as any[]
  if (claimed.length === 0) {
    return NextResponse.json({ ok: true, claimed: 0 })
  }

  // Serial dispatch — Google API rate limits are generous but each
  // call is ~150-300ms; 25 in series is well under the 300s cron
  // budget. Parallelism would buy little here and complicate retry
  // backoff accounting.
  for (const row of claimed) {
    await dispatchOneTradeShowSync(row)
  }

  return NextResponse.json({ ok: true, claimed: claimed.length })
}

export async function GET(req: Request)  { return run(req) }
export async function POST(req: Request) { return run(req) }
