// Cron worker: flushes deferred accountant emails whose
// accountant_email_send_after has come due. Runs every 15 minutes.
//
// Auth: ?secret=<CRON_SECRET> matching the existing vercel.json
// cron-route convention.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendAccountantEmailForReport } from '@/lib/expenses/sendAccountantEmail'

export const dynamic = 'force-dynamic'

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
  const { data: rows, error } = await sb
    .from('expense_reports')
    .select('id')
    .eq('status', 'approved')
    .is('accountant_email_sent_at', null)
    .not('accountant_email_send_after', 'is', null)
    .lte('accountant_email_send_after', new Date().toISOString())
    .limit(50)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const due = rows ?? []
  if (due.length === 0) return NextResponse.json({ ok: true, flushed: 0 })

  const portalBaseUrl = `${url.protocol}//${url.host}`
  const outcomes = []
  for (const r of due) {
    try {
      const result = await sendAccountantEmailForReport(r.id, { portalBaseUrl })
      if (result.ok) {
        // Send succeeded — sendAccountantEmailForReport already stamped
        // accountant_email_sent_at, so the row drops out of the queue
        // on its own. Clear the schedule for tidiness.
        await sb.from('expense_reports')
          .update({ accountant_email_send_after: null })
          .eq('id', r.id)
      }
      outcomes.push({ id: r.id, ...result })
    } catch (err: any) {
      // Leave accountant_email_send_after in place so we retry on the
      // next cron tick. (No exponential back-off — failures here are
      // rare; if they're not, we'll add it.)
      outcomes.push({ id: r.id, ok: false, error: err?.message ?? 'unknown' })
    }
  }

  const ok = outcomes.filter(o => o.ok).length
  return NextResponse.json({ ok: true, flushed: outcomes.length, succeeded: ok, failed: outcomes.length - ok, outcomes })
}

export async function GET(req: Request) { return run(req) }
export async function POST(req: Request) { return run(req) }
