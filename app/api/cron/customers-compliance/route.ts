// Daily cron: finalize right-to-be-forgotten requests whose grace
// period has elapsed.
//
// For each compliance_actions row with action=
// 'right_to_be_forgotten_initiated' that has no matching
// 'right_to_be_forgotten_finalized' row AND meta.scheduled_finalize_at
// has passed, hard-delete the customer (cascade removes tags +
// mailings + events) and log a 'right_to_be_forgotten_finalized'
// row. The original initiated row stays for legal record.
//
// Auth: ?secret=<CRON_SECRET> matching vercel.json.

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

interface PendingRow {
  id: string
  customer_id: string | null
  customer_email_snapshot: string | null
  customer_name_snapshot: string | null
  meta: { scheduled_finalize_at?: string } | null
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const secret = url.searchParams.get('secret') || ''
  const expected = process.env.CRON_SECRET || 'bebportal2024'
  if (secret !== expected) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = admin()

  // Pull all initiated RTFs whose finalize date has passed.
  const nowIso = new Date().toISOString()
  const { data: initiated } = await sb.from('compliance_actions')
    .select('id, customer_id, customer_email_snapshot, customer_name_snapshot, meta')
    .eq('action', 'right_to_be_forgotten_initiated')
  const candidates = ((initiated || []) as PendingRow[])
    .filter(r => r.customer_id && r.meta?.scheduled_finalize_at && r.meta.scheduled_finalize_at < nowIso)

  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, finalized: 0, ran_at: nowIso })
  }

  // Filter out anything we already finalized.
  const ids = candidates.map(c => c.customer_id!).filter(Boolean)
  const { data: alreadyFinalized } = await sb.from('compliance_actions')
    .select('customer_id')
    .eq('action', 'right_to_be_forgotten_finalized')
    .in('customer_id', ids)
  const finalizedSet = new Set(((alreadyFinalized || []) as { customer_id: string }[]).map(r => r.customer_id))
  const toProcess = candidates.filter(c => c.customer_id && !finalizedSet.has(c.customer_id))

  let finalized = 0
  const errors: string[] = []
  for (const row of toProcess) {
    if (!row.customer_id) continue
    // Hard-delete (cascade FKs remove tags / mailings / events / dedup queue rows).
    const { error: delErr } = await sb.from('customers').delete().eq('id', row.customer_id)
    if (delErr) {
      // Customer may already be gone — log and continue.
      errors.push(`${row.customer_id}: ${delErr.message}`)
    }
    await sb.from('compliance_actions').insert({
      customer_id: row.customer_id,
      customer_email_snapshot: row.customer_email_snapshot,
      customer_name_snapshot: row.customer_name_snapshot,
      action: 'right_to_be_forgotten_finalized',
      meta: { initiated_action_id: row.id },
    })
    finalized++
  }

  return NextResponse.json({
    ok: true, finalized,
    candidates: candidates.length,
    skipped_already_done: candidates.length - toProcess.length,
    errors: errors.length > 0 ? errors : undefined,
    ran_at: nowIso,
  })
}
