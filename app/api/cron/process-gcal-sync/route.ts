// Vercel cron worker for the Google Calendar sync queue.
// Runs every minute. Same auth pattern (?secret=CRON_SECRET) as the
// other crons in vercel.json.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { dispatchOneSync } from '@/lib/gcal/dispatcher'

export const dynamic = 'force-dynamic'

const BATCH_SIZE = 25
const RPS_DELAY_MS = 110  // ~9 req/s, well under Google's 10/s soft cap

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
  const { data: claimed, error } = await sb.rpc('claim_due_gcal_syncs', { batch_size: BATCH_SIZE })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (claimed || []) as any[]
  if (rows.length === 0) return NextResponse.json({ ok: true, claimed: 0 })

  const results: any[] = []
  for (const row of rows) {
    try {
      const r = await dispatchOneSync(row)
      results.push(r)
    } catch (e: any) {
      console.error('[gcal-cron] dispatcher crash for row', row.id, e)
      // Restore to pending so the next minute retries.
      await sb.from('gcal_sync_queue').update({
        status: 'pending',
        last_error: `dispatcher_crash: ${e?.message || 'unknown'}`,
        updated_at: new Date().toISOString(),
      }).eq('id', row.id)
      results.push({ rowId: row.id, outcome: 'crashed', error: e?.message })
    }
    // Cheap rate-limit between Google API calls.
    await new Promise(r => setTimeout(r, RPS_DELAY_MS))
  }

  const summary = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.outcome] = (acc[r.outcome] || 0) + 1
    return acc
  }, {})

  return NextResponse.json({ ok: true, claimed: rows.length, summary })
}

export async function POST(req: Request) { return run(req) }
export async function GET(req: Request) { return run(req) }
