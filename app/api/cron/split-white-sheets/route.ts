// Vercel cron worker for the white-sheet PDF splitter.
// Runs every minute. Drains one upload at a time so a single huge
// PDF (~100 pages, ~3 minutes wall-clock to split) doesn't block
// the cron lane for the next one.
//
// Auth: ?secret=<CRON_SECRET>. Same pattern as the other crons in
// vercel.json (process-gcal-sync etc.).

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { splitWhiteSheetPdf } from '@/lib/white-sheets/split'

export const dynamic = 'force-dynamic'

// Splitting a 100-page color scan from cold start takes ~60-90s.
// 300s gives generous headroom for the rare 200+ page batch.
// (Vercel Pro tier supports up to 300s on Node functions.)
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

  // Pick the oldest splitting upload. One per cron tick — splitting
  // is CPU+I/O-bound and we don't want two big splits competing.
  // If we ever need throughput we'll add a `claim` RPC like
  // claim_due_gcal_syncs; today FIFO is fine.
  const { data: upload, error: pickError } = await sb
    .from('white_sheet_uploads')
    .select('id, event_id, brand, source_pdf_path')
    .eq('status', 'splitting')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (pickError) {
    return NextResponse.json({ error: 'pick_failed', detail: pickError.message }, { status: 500 })
  }
  if (!upload) {
    return NextResponse.json({ ok: true, claimed: 0 })
  }

  try {
    const result = await splitWhiteSheetPdf({
      uploadId:      (upload as any).id,
      eventId:       (upload as any).event_id,
      brand:         (upload as any).brand,
      sourcePdfPath: (upload as any).source_pdf_path,
    })
    return NextResponse.json({
      ok: true,
      upload_id: (upload as any).id,
      pages_total: result.pagesTotal,
      pages_inserted: result.pagesInserted,
    })
  } catch (e: any) {
    const message = e?.message || 'unknown'
    console.error('[split-white-sheets] crash for upload', (upload as any).id, e)
    // Flip the upload to 'complete' with pages_errored++ so the
    // operator sees the error in the Hub launcher and can re-
    // upload. A retry semantics ladder (like the gcal queue's
    // backoff) is a future polish; for now one shot then alert.
    await sb.from('white_sheet_uploads').update({
      status: 'complete',
      pages_errored: 1,
      completed_at: new Date().toISOString(),
    }).eq('id', (upload as any).id)
    return NextResponse.json({
      ok: false,
      upload_id: (upload as any).id,
      error: message,
    }, { status: 500 })
  }
}

export async function GET(req: Request)  { return run(req) }
export async function POST(req: Request) { return run(req) }
