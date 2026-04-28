// Cron worker: refresh carrier status for in-flight tracked boxes.
// Auth follows the same `?secret=<CRON_SECRET>` pattern as the rest of
// the cron routes in vercel.json.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { claimDueBoxes, pollOneBox } from '@/lib/shipping/poll'

export const dynamic = 'force-dynamic'

const BATCH_SIZE = 25
const MIN_INTERVAL_MS = 15 * 60 * 1000 // don't poll the same box more than 4×/hr

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
  let boxes
  try {
    boxes = await claimDueBoxes(sb, { batchSize: BATCH_SIZE, minIntervalMs: MIN_INTERVAL_MS })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'claim failed' }, { status: 500 })
  }
  if (boxes.length === 0) {
    return NextResponse.json({ ok: true, polled: 0 })
  }

  // Sequential to be polite to carrier APIs and stay well under any rate limits.
  const outcomes = []
  for (const b of boxes) {
    outcomes.push(await pollOneBox(b, sb))
  }
  const ok = outcomes.filter(o => o.ok).length
  const failed = outcomes.length - ok
  const autoReceived = outcomes.filter(o => o.autoReceived).length
  return NextResponse.json({ ok: true, polled: outcomes.length, succeeded: ok, failed, autoReceived, outcomes })
}

export async function GET(req: Request) { return run(req) }
export async function POST(req: Request) { return run(req) }
