// Vercel cron worker — OCR phase for white sheets.
// Runs every minute. Drains up to N pending pages per tick by
// claiming them atomically via claim_due_white_sheet_pages (a
// SECURITY DEFINER RPC using FOR UPDATE SKIP LOCKED — mirrors the
// gcal_sync_queue + notifications pattern).
//
// Within a single tick, claimed pages are processed in parallel
// (default 8) against the Anthropic Vision API. A 100-page upload
// settles in ~13 ticks at this rate (≈13 minutes).
//
// Auth: ?secret=<CRON_SECRET>. Same pattern as the other crons in
// vercel.json.
//
// Failure handling: any thrown error inside processWhiteSheetPage
// is swallowed and recorded on the row (status='errored',
// last_error=message). The cron itself never 500s on a per-page
// failure — it just returns the batch summary so Vercel logs the
// totals.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  processWhiteSheetPage,
  fetchUploadContext,
  fetchReviewEveryPageMap,
  type ClaimedPage,
} from '@/lib/white-sheets/process'

export const dynamic = 'force-dynamic'

// 300s max — generous headroom. Each page takes ~5-10s wall-clock
// (download PDF + Claude vision + dedup write); 8 in parallel
// settles in ~10-15s. The 300s ceiling protects against an
// occasional slow Anthropic response without ever holding the cron
// lane open.
export const maxDuration = 300

// Batch size per cron tick. Spec calls for 8 in parallel.
//   - balances Anthropic rate limits against drain speed
//   - 100-page upload finishes in ~13 ticks (≈13 minutes at 1/min)
//   - if we add a second cron parallelism, raise to 16 here.
const BATCH_SIZE = 8

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

  // ── 1. Claim a batch of pending pages atomically ──────────
  const { data: claimedRaw, error: claimErr } = await sb
    .rpc('claim_due_white_sheet_pages', { batch_size: BATCH_SIZE })
  if (claimErr) {
    return NextResponse.json({ error: 'claim_failed', detail: claimErr.message }, { status: 500 })
  }
  const claimed = (claimedRaw || []) as ClaimedPage[]
  if (claimed.length === 0) {
    return NextResponse.json({ ok: true, claimed: 0 })
  }

  // ── 2. Pull upload-level context once per distinct upload ─
  // Cache so an 8-page batch from the same upload makes 1 DB
  // round-trip for brand/store_id/event_start_date instead of 8.
  const uniqueUploads = Array.from(new Set(claimed.map(p => p.upload_id)))
  const ctxByUpload = new Map<string, Awaited<ReturnType<typeof fetchUploadContext>>>()
  await Promise.all(uniqueUploads.map(async uId => {
    ctxByUpload.set(uId, await fetchUploadContext(uId))
  }))
  const reviewEveryPageMap = await fetchReviewEveryPageMap()

  // ── 3. Process pages in parallel ───────────────────────────
  // Each promise resolves with a ProcessOutcome (never throws).
  // Concurrency is bounded by the batch size; no additional
  // p-limit because batch_size IS the bound.
  const outcomes = await Promise.all(claimed.map(async page => {
    const ctx = ctxByUpload.get(page.upload_id)
    if (!ctx) {
      // The upload row vanished between claim and process.
      // Defensive — surfaces as an errored page rather than a
      // crash so the cron tick completes cleanly.
      return {
        page_id: page.id,
        status: 'errored' as const,
        review_reasons: [],
        error: 'upload_context_missing',
      }
    }
    return processWhiteSheetPage(page, {
      brand: ctx.brand,
      store_id: ctx.store_id,
      event_start_date: ctx.event_start_date,
      review_every_page: !!(ctx.brand && reviewEveryPageMap[ctx.brand]),
    })
  }))

  // ── 4. Summarize for the response body ─────────────────────
  const summary = {
    claimed: claimed.length,
    auto_committed: outcomes.filter(o => o.status === 'auto_committed').length,
    needs_review:   outcomes.filter(o => o.status === 'needs_review').length,
    errored:        outcomes.filter(o => o.status === 'errored').length,
    page_ids:       outcomes.map(o => o.page_id),
  }

  return NextResponse.json({ ok: true, ...summary })
}

export async function GET(req: Request)  { return run(req) }
export async function POST(req: Request) { return run(req) }
