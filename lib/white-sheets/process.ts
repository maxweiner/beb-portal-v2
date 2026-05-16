// Per-page orchestrator for the white-sheet OCR worker.
//
// Called by /api/cron/process-white-sheets after the claim RPC
// has flipped a batch of rows from 'pending' → 'processing'.
// Owns the full life-cycle of a single page:
//
//   1. OCR via Claude vision (lib/white-sheets/ocr.ts).
//   2. Match-back + 5-check auto-commit (lib/white-sheets/match.ts).
//      In Phase 3 every page lands needs_review because the
//      buyer-initials classifier isn't built yet; Phase 5 will
//      flip clean pages to auto_committed.
//   3. Customer write — only on auto_committed pages. Phase 3
//      reaches this branch zero times in practice; kept wired so
//      Phase 4 (operator confirm) + Phase 5 (initials classifier)
//      can call the same orchestrator path.
//   4. Update the page row with extracted fields + status +
//      review_reasons. Bump the parent upload's running counters.
//   5. Call finalize_white_sheet_upload_if_done — closes out the
//      upload + stamps completed_at when this was the last page
//      to settle.
//
// Errors at any step write status='errored' with last_error
// populated. The page surfaces in the review pile with a Retry
// button (Phase 4).

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { ocrWhiteSheetPage, type WhiteSheetOcrResult } from './ocr'
import { applyAutoCommitChecks } from './match'
import { classifyBuyerInitials, type ClassifierResult } from './classifyInitials'
import { dedupAndUpsertWhiteSheetCustomer } from './customerWrite'
import { sendCompletionEmail } from './notify'
import type { WhiteSheetReviewReason } from '@/types'

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

/** Shape of a claimed row as returned by claim_due_white_sheet_pages. */
export interface ClaimedPage {
  id: string
  upload_id: string
  event_id: string
  page_number: number
  page_pdf_path: string | null
  status: string  // already 'processing' at this point
  attempts: number
}

export interface ProcessOutcome {
  page_id: string
  /** Final status the page settled into. */
  status: 'auto_committed' | 'needs_review' | 'errored'
  /** Soft flags (for telemetry / debug). */
  review_reasons: WhiteSheetReviewReason[]
  /** Whether a customers row was created/merged on this run. */
  customer_action?: 'merge' | 'create' | 'skipped'
  /** Cost cents charged for this page's OCR call. */
  cost_cents?: number
  /** When status='errored', the recorded error message. */
  error?: string
}

/** Pull the per-upload context the orchestrator needs: brand (for
 *  the review_every_page setting), event.store_id (for customer
 *  dedup scope), event.start_date (for last_contact_date push).
 *
 *  Cached at the cron-route layer so a 8-parallel batch hits Supabase
 *  once per distinct upload, not 8×. */
export async function fetchUploadContext(uploadId: string): Promise<{
  brand: string | null
  event_id: string
  store_id: string | null
  event_start_date: string | null
} | null> {
  const sb = admin()
  const { data: upload, error } = await sb
    .from('white_sheet_uploads')
    .select('id, brand, event_id, events!inner(id, store_id, start_date)')
    .eq('id', uploadId)
    .maybeSingle()
  if (error || !upload) return null
  const ev = (upload as any).events
  return {
    brand: (upload as any).brand ?? null,
    event_id: (upload as any).event_id,
    store_id: ev?.store_id ?? null,
    event_start_date: ev?.start_date ?? null,
  }
}

/** Look up the brand-scoped "Review every page" toggle once per
 *  cron tick. Returns the boolean for a specific brand, defaulting
 *  to false if the setting is missing. */
export async function fetchReviewEveryPageMap(): Promise<Record<string, boolean>> {
  const sb = admin()
  const { data } = await sb
    .from('settings')
    .select('value')
    .eq('key', 'white_sheets.review_every_page')
    .maybeSingle()
  const value = (data as any)?.value
  if (!value || typeof value !== 'object') return {}
  // jsonb stores it as { beb: false, liberty: false } per Phase 1
  // migration.
  return value as Record<string, boolean>
}

/** Process one claimed page. Always returns a ProcessOutcome —
 *  never throws. */
export async function processWhiteSheetPage(
  page: ClaimedPage,
  ctx: {
    brand: string | null
    store_id: string | null
    event_start_date: string | null
    review_every_page: boolean
  },
): Promise<ProcessOutcome> {
  const sb = admin()

  if (!page.page_pdf_path) {
    return markErrored(sb, page, 'no_page_pdf_path')
  }

  // ── 1. OCR ────────────────────────────────────────────────
  let ocr: WhiteSheetOcrResult
  try {
    ocr = await ocrWhiteSheetPage(page.page_pdf_path)
  } catch (e: any) {
    const message = e?.message || 'ocr_failed'
    // Anthropic 429 (org token-per-minute cap exceeded) is a
    // transient failure — the next cron tick should succeed once
    // the minute window rolls over. Instead of permanently
    // erroring the page (forcing manual reset), flip it back to
    // 'pending' so the cron re-claims it.
    //
    // We cap retries at MAX_429_ATTEMPTS so a sustained Anthropic
    // outage / billing freeze eventually surfaces as a real error
    // rather than looping forever.
    const MAX_429_ATTEMPTS = 10
    const isRateLimit = /429|rate_limit_error/i.test(message)
    if (isRateLimit && page.attempts < MAX_429_ATTEMPTS) {
      await updatePageRow(sb, page.id, {
        status: 'pending',
        last_error: `transient: ${message.slice(0, 200)}`,
      })
      return {
        page_id: page.id,
        status: 'errored',  // outcome label for the cron-summary log
        review_reasons: [],
        error: 'rate_limited_retry',
      }
    }
    return markErrored(sb, page, message)
  }

  // Unparseable page (scanner separator, blank, etc.) — route to
  // errored with the OCR-supplied reason so the operator can re-
  // scan or drop the page from the upload.
  if (ocr.unparseable) {
    await updatePageRow(sb, page.id, {
      status: 'errored',
      review_reasons: ['errored' as WhiteSheetReviewReason],
      ocr_raw: ocr as any,
      last_error: `unparseable: ${ocr.unparseable_reason || 'unknown'}`,
      processed_at: new Date().toISOString(),
    })
    await bumpUploadCounters(sb, page.upload_id, { pages_errored: 1, cost_cents: ocr.cost_cents })
    await finalizeIfDone(sb, page.upload_id)
    return {
      page_id: page.id,
      status: 'errored',
      review_reasons: ['errored' as WhiteSheetReviewReason],
      cost_cents: ocr.cost_cents,
      error: `unparseable: ${ocr.unparseable_reason || 'unknown'}`,
    }
  }

  // ── 2a. Buyer-initials classifier (Phase 5) ───────────────
  // Closed-set vision call against the event's assigned workers
  // using each worker's active signature samples as references.
  // Returns { confident, best_user_id, best_score, ... } — see
  // lib/white-sheets/classifyInitials.ts for the threshold logic.
  // Failure modes (network, cold-start, missing samples) return
  // a non-confident verdict rather than throwing; the page just
  // flows into the review pile with 'initials_pending' as
  // before.
  let classifier: ClassifierResult | null = null
  try {
    classifier = await classifyBuyerInitials(page.page_pdf_path, page.event_id)
  } catch (e: any) {
    console.warn('[whiteSheets.process] classifier crashed for page', page.id, e?.message)
    classifier = {
      confident: false,
      best_user_id: null,
      best_score: null,
      second_best_score: null,
      skipped_reason: 'classifier_error',
      raw_text: e?.message?.slice(0, 200),
    }
  }

  // ── 2b. Match-back + auto-commit checks ───────────────────
  const match = await applyAutoCommitChecks(ocr, page.event_id, classifier)

  // Brand-wide review_every_page override forces needs_review.
  // The orchestrator still runs OCR + match-back, just routes the
  // page to the pile regardless of the 5-check result.
  const forceReview = !!ctx.review_every_page
  const finalStatus: 'auto_committed' | 'needs_review' =
    (match.recommended_status === 'auto_committed' && !forceReview)
      ? 'auto_committed'
      : 'needs_review'

  // ── 3. Customer write — only on auto_committed ─────────────
  // Phase 3 reaches this branch ~never (initials_pending is always
  // present), but the wiring exists for Phase 5+ to use the same
  // orchestrator path.
  let customerWriteResult: { customer_id: string | null; action: 'merge' | 'create' | 'skipped' } = {
    customer_id: null, action: 'skipped',
  }
  if (finalStatus === 'auto_committed' && ctx.store_id) {
    customerWriteResult = await dedupAndUpsertWhiteSheetCustomer({
      storeId: ctx.store_id,
      eventStartDate: ctx.event_start_date,
      ocr,
    })
  }

  // ── 4. Persist the page row ─────────────────────────────────
  // Bake the classifier result into ocr_raw under a dedicated key
  // so the review pile UI + future model-version comparisons keep
  // an audit trail. Plus surface buyer_user_id / confidence on
  // dedicated columns (review pile's pill row pre-selects the
  // best guess even when the classifier wasn't confident enough
  // to auto-commit).
  const ocrPayload: any = { ...ocr }
  if (classifier) {
    ocrPayload.initials_classifier = {
      confident: classifier.confident,
      best_user_id: classifier.best_user_id,
      best_score: classifier.best_score,
      second_best_score: classifier.second_best_score,
      skipped_reason: classifier.skipped_reason || null,
      scores: classifier.scores || {},
    }
  }

  await updatePageRow(sb, page.id, {
    status: finalStatus,
    review_reasons: match.review_reasons,
    ocr_raw: ocrPayload,
    buy_form_number_ocr: ocr.buy_form_number?.value ?? null,
    check_number_ocr:    ocr.check_number?.value    ?? null,
    amount_ocr:          ocr.amount?.value          ?? null,
    id_number_raw:       ocr.id_number?.value       ?? null,
    items_raw:           ocr.items_description?.value ?? null,
    buyer_check_id:      match.buyer_check_id,
    customer_id:         customerWriteResult.customer_id,
    buyer_user_id:       classifier?.best_user_id ?? null,
    initials_classifier_confidence: classifier?.best_score ?? null,
    processed_at:        new Date().toISOString(),
  })

  // ── 5. Bump parent upload counters ──────────────────────────
  const counterPatch: BumpCountersPatch = { cost_cents: ocr.cost_cents }
  if (finalStatus === 'auto_committed') counterPatch.pages_auto_committed = 1
  else                                  counterPatch.pages_in_review = 1
  await bumpUploadCounters(sb, page.upload_id, counterPatch)

  // ── 6. Finalize the upload if this was the last page ────────
  await finalizeIfDone(sb, page.upload_id)

  return {
    page_id: page.id,
    status: finalStatus,
    review_reasons: match.review_reasons,
    customer_action: customerWriteResult.action,
    cost_cents: ocr.cost_cents,
  }
}

// ─────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────

interface UpdatePageRowPatch {
  // 'pending' is only valid for the 429-retry path — pushes the row
  // back into the cron's claim queue. Every other call site must
  // pick a terminal status.
  status: 'auto_committed' | 'needs_review' | 'errored' | 'pending'
  review_reasons?: WhiteSheetReviewReason[]
  ocr_raw?: Record<string, unknown> | null
  buy_form_number_ocr?: string | null
  check_number_ocr?: string | null
  amount_ocr?: number | null
  id_number_raw?: string | null
  items_raw?: string | null
  buyer_check_id?: string | null
  customer_id?: string | null
  buyer_user_id?: string | null
  initials_classifier_confidence?: number | null
  last_error?: string | null
  processed_at?: string
}

async function updatePageRow(sb: SupabaseClient, pageId: string, patch: UpdatePageRowPatch) {
  const { error } = await sb
    .from('white_sheet_pages')
    .update(patch)
    .eq('id', pageId)
  if (error) {
    console.warn('[whiteSheets.process] updatePageRow failed', pageId, error.message)
  }
}

interface BumpCountersPatch {
  pages_auto_committed?: number
  pages_in_review?: number
  pages_errored?: number
  cost_cents?: number
}

/** Increment the parent upload's running counters. Implemented
 *  with a read-modify-write because Supabase JS doesn't surface
 *  an `increment` call — the rows are very low-contention (one
 *  per upload, and the cron drains them sequentially across
 *  parallel pages of the same upload), so the read-write race
 *  is acceptable. If we ever see drift we'll move this to a
 *  SECURITY DEFINER RPC. */
async function bumpUploadCounters(
  sb: SupabaseClient,
  uploadId: string,
  patch: BumpCountersPatch,
) {
  const { data: current } = await sb
    .from('white_sheet_uploads')
    .select('pages_auto_committed, pages_in_review, pages_errored, estimated_cost_cents')
    .eq('id', uploadId)
    .maybeSingle()
  if (!current) return

  const next: Record<string, number> = {}
  if (patch.pages_auto_committed) next.pages_auto_committed = ((current as any).pages_auto_committed || 0) + patch.pages_auto_committed
  if (patch.pages_in_review)      next.pages_in_review      = ((current as any).pages_in_review      || 0) + patch.pages_in_review
  if (patch.pages_errored)        next.pages_errored        = ((current as any).pages_errored        || 0) + patch.pages_errored
  if (patch.cost_cents)           next.estimated_cost_cents = ((current as any).estimated_cost_cents || 0) + patch.cost_cents
  if (Object.keys(next).length === 0) return

  const { error } = await sb
    .from('white_sheet_uploads')
    .update(next)
    .eq('id', uploadId)
  if (error) console.warn('[whiteSheets.process] bumpUploadCounters failed', uploadId, error.message)
}

async function finalizeIfDone(sb: SupabaseClient, uploadId: string) {
  // Phase 6: the RPC now returns a richer string so we can
  // distinguish the transition (this call did the flip) from
  // a no-op (upload was already complete on entry). Only fire
  // the completion email on the transition — that's our
  // exactly-once gate.
  const { data, error } = await sb.rpc('finalize_white_sheet_upload_if_done', { upload_uuid: uploadId })
  if (error) {
    console.warn('[whiteSheets.process] finalize_if_done failed', uploadId, error.message)
    return
  }
  if (data === 'just_finalized') {
    // sendCompletionEmail handles its own errors + the
    // notification_sent_at gating, so we can fire-and-forget.
    // Awaited so a crash before the email send doesn't leave the
    // worker tick in a weird half-state, but errors are swallowed
    // inside sendCompletionEmail itself.
    await sendCompletionEmail(uploadId)
  }
}

async function markErrored(sb: SupabaseClient, page: ClaimedPage, message: string): Promise<ProcessOutcome> {
  await updatePageRow(sb, page.id, {
    status: 'errored',
    review_reasons: ['errored' as WhiteSheetReviewReason],
    last_error: message,
    processed_at: new Date().toISOString(),
  })
  await bumpUploadCounters(sb, page.upload_id, { pages_errored: 1 })
  await finalizeIfDone(sb, page.upload_id)
  return {
    page_id: page.id,
    status: 'errored',
    review_reasons: ['errored' as WhiteSheetReviewReason],
    error: message,
  }
}
