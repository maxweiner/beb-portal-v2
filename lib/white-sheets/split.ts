// White Sheet splitter — downloads a source PDF from Supabase
// Storage, splits it into per-page single-page PDFs via pdf-lib,
// uploads each per-page PDF back to storage, and inserts a
// white_sheet_pages row per page in status='pending'.
//
// Called by /api/cron/split-white-sheets after the operator
// finalizes an upload. Idempotent within a single upload: if the
// splitter has already inserted some pages (e.g., it crashed
// mid-run), the (upload_id, page_number) UNIQUE constraint
// short-circuits the re-insert and the storage upload uses upsert.
//
// Architectural note: Phase 2 intentionally does NOT render the
// pages to PNG. Claude vision accepts PDF document blocks
// natively, so a per-page PDF is sufficient for both the OCR call
// (Phase 3) and the review-pile preview (browser-side pdfjs-dist).

import { PDFDocument } from 'pdf-lib'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

const BUCKET = 'white-sheets'

let _admin: SupabaseClient | null = null
function admin(): SupabaseClient {
  if (_admin) return _admin
  _admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
  return _admin
}

/** Storage path for a given page within an upload. */
export function pagePdfStoragePath(
  brand: string, eventId: string, uploadId: string, pageNumber: number,
): string {
  return `${brand}/${eventId}/${uploadId}/page-${String(pageNumber).padStart(4, '0')}.pdf`
}

export interface SplitInput {
  uploadId: string
  eventId: string
  brand: string
  sourcePdfPath: string
}

export interface SplitResult {
  pagesTotal: number
  pagesInserted: number
}

export async function splitWhiteSheetPdf(input: SplitInput): Promise<SplitResult> {
  const sb = admin()
  const { uploadId, eventId, brand, sourcePdfPath } = input

  // 1. Download the source PDF from the white-sheets bucket. The
  //    bucket is private; service-role bypasses RLS so we read
  //    directly without signing.
  const { data: sourceBlob, error: dlError } = await sb.storage
    .from(BUCKET)
    .download(sourcePdfPath)
  if (dlError || !sourceBlob) {
    throw new Error(`download_failed: ${dlError?.message || 'no body'} (${sourcePdfPath})`)
  }
  const sourceBytes = new Uint8Array(await sourceBlob.arrayBuffer())

  // 2. Parse with pdf-lib. ignoreEncryption lets us handle scans
  //    that came out of consumer scanner software that flags
  //    "owner password" with no actual restrictions.
  const sourceDoc = await PDFDocument.load(sourceBytes, { ignoreEncryption: true })
  const pageCount = sourceDoc.getPageCount()
  if (pageCount === 0) {
    throw new Error('source_pdf_has_zero_pages')
  }

  // 3. Split + upload + insert per-page row, one at a time.
  //    Sequential rather than parallel because: (a) pdf-lib's
  //    copyPages mutates internal cross-reference state and isn't
  //    safe under concurrent use; (b) Supabase Storage throttles
  //    aggressive parallel writes from a single key and
  //    sequential keeps us well under any limit. ~100 pages
  //    settles in 30-60s wall-clock on a warm Vercel instance.
  let inserted = 0
  for (let i = 0; i < pageCount; i++) {
    const pageNumber = i + 1

    // pdf-lib idiom: create a fresh empty doc, copy one page from
    // the source, save, upload. Each pageDoc owns its own xref so
    // there's no cross-page contamination.
    const pageDoc = await PDFDocument.create()
    const [copied] = await pageDoc.copyPages(sourceDoc, [i])
    pageDoc.addPage(copied)
    const pageBytes = await pageDoc.save()

    const path = pagePdfStoragePath(brand, eventId, uploadId, pageNumber)
    const { error: upError } = await sb.storage
      .from(BUCKET)
      .upload(path, pageBytes, {
        contentType: 'application/pdf',
        upsert: true,  // idempotent re-run support
      })
    if (upError) {
      throw new Error(`page_upload_failed: ${upError.message} (page ${pageNumber})`)
    }

    // Insert the page row. Conflict on (upload_id, page_number)
    // is silently skipped — happens when a retry re-runs over
    // already-inserted pages.
    const { error: insError } = await sb
      .from('white_sheet_pages')
      .upsert({
        upload_id: uploadId,
        event_id: eventId,
        page_number: pageNumber,
        page_pdf_path: path,
        status: 'pending',
        review_reasons: [],
      }, { onConflict: 'upload_id,page_number', ignoreDuplicates: false })
    if (insError) {
      throw new Error(`page_insert_failed: ${insError.message} (page ${pageNumber})`)
    }
    inserted++
  }

  // 4. Flip the upload row to processing + stamp pages_total. Phase
  //    3's OCR cron picks up pages with page-status 'pending' from
  //    here.
  const { error: updError } = await sb
    .from('white_sheet_uploads')
    .update({
      pages_total: pageCount,
      status: 'processing',
    })
    .eq('id', uploadId)
  if (updError) {
    throw new Error(`upload_status_update_failed: ${updError.message}`)
  }

  return { pagesTotal: pageCount, pagesInserted: inserted }
}
