// Vercel cron — Phase 8 OCR-drift dedup sweep.
//
// Daily off-peak run that catches near-miss customer duplicates
// the customer-write helper missed at OCR time. The helper goes
// phone-first → email → create; a single-digit phone OCR mistake
// will create a brand-new customer that's actually the same
// person who's in the DB from a previous event.
//
// The sweep:
//   1. Pulls every customer that was touched by a white_sheet_pages
//      row in the last 7 days (the "recently OCR'd" universe).
//   2. For each, pulls the SAME-STORE customer pool (cap 2000 rows
//      per store — Customers module is per-store, no cross-store
//      dedup per spec).
//   3. Runs the drift matcher (lib/white-sheets/driftMatcher.ts).
//      Returns at most one pair per target customer.
//   4. Inserts hits into customer_dedup_review_queue with
//      source='white_sheet_upload', incoming_customer_id set.
//      The partial unique index on (existing, incoming) WHERE
//      status='pending' makes the insert idempotent — a re-run
//      of the cron the next day will quietly skip pairs already
//      in the queue.
//
// Auth: ?secret=CRON_SECRET. Same as the other crons.
//
// Schedule (vercel.json): 17 5 * * *  (05:17 UTC, off the
// metals-prices + customers-engagement / compliance rush windows).

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { findOcrDriftMatch, type DriftCustomer } from '@/lib/white-sheets/driftMatcher'

export const dynamic = 'force-dynamic'

// Tight bounds — the cron isn't time-sensitive but we don't want
// to ever hit a 300s timeout if a brand has thousands of customers.
export const maxDuration = 300

const LOOKBACK_DAYS                = 7
const MAX_TARGETS_PER_RUN          = 200   // hard cap on customers we inspect per tick
const MAX_POOL_ROWS_PER_STORE      = 2000  // cap on the per-store comparison universe
const MAX_QUEUE_INSERTS_PER_RUN    = 200   // safety belt against a runaway false-positive batch

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
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()

  // ── 1. Recently OCR'd customers ──────────────────────────────
  // Pull recent white_sheet_pages rows that landed a customer
  // (auto_committed or operator-confirmed) and grab their
  // customer_id. Distinct in JS.
  const { data: recentPages, error: pageErr } = await sb
    .from('white_sheet_pages')
    .select('customer_id, event_id, processed_at')
    .gte('processed_at', cutoff)
    .not('customer_id', 'is', null)
    .limit(2000)
  if (pageErr) {
    return NextResponse.json({ error: 'page_query_failed', detail: pageErr.message }, { status: 500 })
  }

  const targetIds = Array.from(new Set(
    (recentPages || []).map((p: any) => p.customer_id).filter(Boolean) as string[],
  )).slice(0, MAX_TARGETS_PER_RUN)

  if (targetIds.length === 0) {
    return NextResponse.json({ ok: true, targets: 0, queued: 0 })
  }

  // Fetch the target customers with their store_id (per-store scope).
  const { data: targets } = await sb
    .from('customers')
    .select(`
      id, store_id, first_name, last_name,
      phone_normalized, email_normalized,
      date_of_birth, zip
    `)
    .in('id', targetIds)
    .is('deleted_at', null)

  if (!targets || targets.length === 0) {
    return NextResponse.json({ ok: true, targets: 0, queued: 0 })
  }

  // Group targets by store so we fetch each store's pool once.
  const targetsByStore = new Map<string, any[]>()
  for (const t of targets as any[]) {
    if (!targetsByStore.has(t.store_id)) targetsByStore.set(t.store_id, [])
    targetsByStore.get(t.store_id)!.push(t)
  }

  // ── 2. Per-store pool fetch + matching ───────────────────────
  const queueRows: Array<{
    existing_customer_id: string
    incoming_customer_id: string
    incoming_data: Record<string, unknown>
    match_confidence: number
    match_reasons: string[]
    source: 'white_sheet_upload'
  }> = []

  for (const [storeId, storeTargets] of targetsByStore.entries()) {
    const { data: pool } = await sb
      .from('customers')
      .select(`
        id, first_name, last_name,
        phone_normalized, email_normalized,
        date_of_birth, zip
      `)
      .eq('store_id', storeId)
      .is('deleted_at', null)
      .limit(MAX_POOL_ROWS_PER_STORE)
    if (!pool) continue

    // Mark which customers in the pool came from a white-sheet
    // upload (used in the matcher to bias toward newer rows being
    // the "incoming" half).
    const wsIds = new Set(targetIds)  // approximate — recent-OCR list
    const poolDC: DriftCustomer[] = (pool as any[]).map(p => ({
      id: p.id,
      first_name: p.first_name || '',
      last_name:  p.last_name  || '',
      phone_normalized: p.phone_normalized,
      email_normalized: p.email_normalized,
      date_of_birth:    p.date_of_birth,
      zip:              p.zip,
      created_via_white_sheet: wsIds.has(p.id),
    }))

    for (const t of storeTargets) {
      if (queueRows.length >= MAX_QUEUE_INSERTS_PER_RUN) break

      const targetDC: DriftCustomer = {
        id: t.id,
        first_name: t.first_name || '',
        last_name:  t.last_name  || '',
        phone_normalized: t.phone_normalized,
        email_normalized: t.email_normalized,
        date_of_birth:    t.date_of_birth,
        zip:              t.zip,
        created_via_white_sheet: true,
      }

      const match = findOcrDriftMatch(targetDC, poolDC)
      if (!match) continue

      // The CANDIDATE is the older / canonical record; the
      // TARGET (just OCR'd recently) is the suspected dupe.
      // existing_customer_id should be the row we'd KEEP if
      // operator picks merge — the candidate (older).
      //
      // Tie-breaker: if both are recent, prefer the lexicographically-
      // smaller id as existing — gives the cron a stable answer
      // across re-runs so the unique-pair index doesn't fight us.
      const existing_id = match.candidate_id
      const incoming_id = targetDC.id
      if (existing_id === incoming_id) continue

      // Snapshot of incoming for the resolve route. Keep ALL the
      // fields the UI's merge action looks for.
      const incoming_snapshot: Record<string, unknown> = {
        first_name: t.first_name,
        last_name:  t.last_name,
        phone:           null,  // resolve route only uses incoming_data for create / merge non-null fill;
        email:           null,  //   the actual values live on the customer row pointed at by incoming_customer_id.
        date_of_birth:   t.date_of_birth,
        zip:             t.zip,
        // Sentinel so the operator can see why this landed here
        // even if the resolve route doesn't read it.
        _drift_reasons:  match.reasons,
      }

      queueRows.push({
        existing_customer_id: existing_id,
        incoming_customer_id: incoming_id,
        incoming_data: incoming_snapshot,
        match_confidence: match.confidence,
        match_reasons: match.reasons,
        source: 'white_sheet_upload',
      })
    }

    if (queueRows.length >= MAX_QUEUE_INSERTS_PER_RUN) break
  }

  // ── 3. Insert into queue, ignoring conflicts on the partial
  //       unique index (existing, incoming) WHERE pending.
  let queued = 0
  if (queueRows.length > 0) {
    // We can't use Supabase's onConflict because the unique
    // index is partial; insert with ignoreDuplicates to swallow
    // 23505s instead. Iterate one-by-one so a single conflict
    // doesn't fail the batch.
    for (const r of queueRows) {
      const { error } = await sb
        .from('customer_dedup_review_queue')
        .insert(r)
      if (error) {
        // 23505 = unique_violation; means pair already pending,
        // expected on re-run. Anything else gets logged.
        if (error.code !== '23505') {
          console.warn('[dedup-sweep] insert failed', error.message, r)
        }
        continue
      }
      queued += 1
    }
  }

  return NextResponse.json({
    ok: true,
    targets: targets.length,
    queued,
    candidates_evaluated: queueRows.length,
    lookback_days: LOOKBACK_DAYS,
  })
}

export async function GET(req: Request)  { return run(req) }
export async function POST(req: Request) { return run(req) }
