// Vercel cron — 90-day per-page PDF storage cleanup.
//
// Per the white-sheet OCR spec, source PDFs are retained
// indefinitely (compliance), but the per-page PDFs we write
// during splitting are bulk storage that doesn't earn its keep
// after the page has settled. After 90 days, this cron:
//
//   1. Picks settled pages (auto_committed / errored) whose
//      created_at is more than 90 days old AND still have a
//      page_pdf_path stamped.
//   2. Deletes the storage object via the service-role client.
//   3. Nulls page_pdf_path on the DB row so the UI knows the
//      preview isn't available anymore (DB row stays — OCR
//      result + audit trail are retained).
//
// Deliberately does NOT touch needs_review pages — those are
// still in front of an operator and the preview is essential.
// We also skip pages whose deletion would fail RLS (we use
// service-role so this is moot, but the predicate is explicit
// for safety).
//
// Daily 4am UTC cadence — well off the operator-active hours
// and the OCR-worker peak. Batches at 500 pages per tick to
// keep the function tight; if there's a backlog the cron is
// idempotent and drains over multiple days.
//
// Auth: ?secret=<CRON_SECRET>, same pattern as the other crons.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

// Storage deletes are cheap; 500/tick is fine. Each tick takes
// ~5-10s wall-clock on a warm Vercel instance.
const BATCH_SIZE   = 500
const DAYS_TO_KEEP = 90
const BUCKET       = 'white-sheets'

// 300s ceiling — generous; the actual run is short.
export const maxDuration = 300

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

  // Cut-off: only pages older than N days. The comparison column
  // is white_sheet_pages.created_at (when the splitter wrote the
  // row), which is also when the storage object was uploaded.
  const cutoff = new Date(Date.now() - DAYS_TO_KEEP * 24 * 60 * 60 * 1000).toISOString()

  const { data: pages, error: pickErr } = await sb
    .from('white_sheet_pages')
    .select('id, upload_id, page_pdf_path, status')
    // Settled statuses only — never blow away a page that's still
    // in front of a reviewer.
    .in('status', ['auto_committed', 'errored'])
    .lt('created_at', cutoff)
    .not('page_pdf_path', 'is', null)
    .limit(BATCH_SIZE)
  if (pickErr) {
    return NextResponse.json({ error: 'pick_failed', detail: pickErr.message }, { status: 500 })
  }

  const claimed = (pages || []) as Array<{ id: string; upload_id: string; page_pdf_path: string; status: string }>
  if (claimed.length === 0) {
    return NextResponse.json({ ok: true, purged: 0 })
  }

  // Delete in one storage call. Supabase Storage's remove() takes
  // an array of paths and returns per-path errors as a list.
  const paths = claimed.map(p => p.page_pdf_path)
  const { data: removed, error: rmErr } = await sb.storage
    .from(BUCKET)
    .remove(paths)
  if (rmErr) {
    // Soft-fail: don't null page_pdf_path if the storage delete
    // didn't fire. Next cron tick retries.
    console.warn('[cleanup-white-sheet-pages] storage.remove failed', rmErr.message)
    return NextResponse.json({ error: 'storage_remove_failed', detail: rmErr.message }, { status: 500 })
  }

  // Null page_pdf_path on the DB rows we just purged. We do this
  // in batches of 100 IDs at a time to stay well under any
  // PostgREST URL-length limit (the `.in()` operator stuffs all
  // ids into a comma-separated query string).
  const ids = claimed.map(p => p.id)
  const CHUNK = 100
  let nulledCount = 0
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK)
    const { error: updErr, count } = await sb
      .from('white_sheet_pages')
      .update({ page_pdf_path: null }, { count: 'exact' })
      .in('id', slice)
    if (updErr) {
      console.warn('[cleanup-white-sheet-pages] DB update failed for chunk', i, updErr.message)
    } else {
      nulledCount += count ?? slice.length
    }
  }

  return NextResponse.json({
    ok: true,
    purged: paths.length,
    db_rows_updated: nulledCount,
    storage_results: Array.isArray(removed) ? removed.length : 0,
    cutoff,
  })
}

export async function GET(req: Request)  { return run(req) }
export async function POST(req: Request) { return run(req) }
