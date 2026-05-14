-- ============================================================
-- White Sheet OCR — PHASE 3: claim RPCs for the OCR worker
--
-- Adds two SECURITY DEFINER RPCs used by /api/cron/process-white-
-- sheets:
--
--   1. claim_due_white_sheet_pages(batch_size INT DEFAULT 8)
--        Atomically flips up to `batch_size` rows from 'pending' →
--        'processing' and returns them. FOR UPDATE SKIP LOCKED so
--        concurrent cron firings (or a manual + cron overlap) never
--        double-claim the same page. Mirrors the gcal_sync_queue +
--        notifications pattern from supabase-migration-gcal-sync.sql.
--
--   2. finalize_white_sheet_upload_if_done(upload_uuid UUID)
--        Flips the upload row to status='complete' + stamps
--        completed_at IFF every page row has reached a terminal
--        status (auto_committed / needs_review / errored). Idempotent
--        (no-op if already complete; no-op if any page is still
--        pending or processing). Called by the worker after each
--        page settles so the last-page-finishing tick is the one
--        that closes the upload.
--
-- Safe to re-run. No new tables / columns — every plumbing piece
-- already exists from the Phase 1 schema.
--
-- Spec: docs/white-sheet-ocr-spec.md
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. claim_due_white_sheet_pages
-- ─────────────────────────────────────────────────────────────
-- Returns the claimed rows in full so the caller doesn't need a
-- second SELECT. Sort by created_at so the splitter's natural
-- page-order is preserved end-to-end (page 1 finishes before
-- page 100). batch_size defaults to 8 per the spec — balances
-- Anthropic rate limits against drain speed (100-page PDF in
-- ~13 cron ticks at 1/min = ~13 minutes).

CREATE OR REPLACE FUNCTION public.claim_due_white_sheet_pages(batch_size INT DEFAULT 8)
RETURNS SETOF public.white_sheet_pages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT id FROM public.white_sheet_pages
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.white_sheet_pages p
     SET status   = 'processing',
         attempts = attempts + 1
    FROM due
   WHERE p.id = due.id
   RETURNING p.*;
END;
$$;

COMMENT ON FUNCTION public.claim_due_white_sheet_pages(INT) IS
  'Atomically claim up to N pending white_sheet_pages rows: flips status to processing, increments attempts, returns the claimed rows. SECURITY DEFINER + SKIP LOCKED so concurrent cron firings never double-claim. Mirrors claim_due_gcal_syncs / claim_due_notifications.';


-- ─────────────────────────────────────────────────────────────
-- 2. finalize_white_sheet_upload_if_done
-- ─────────────────────────────────────────────────────────────
-- "Are we there yet?" check that flips the upload to 'complete'
-- once every page has settled. Two reasons for an RPC vs. doing
-- this client-side:
--   (a) atomicity — counting pending/processing pages and the
--       UPDATE happen in one transaction; no race with another
--       worker enqueuing or settling a page between our SELECT
--       and UPDATE.
--   (b) the worker calls this 8 times per cron tick (once per
--       processed page); SQL is cheaper than 8 round-trips.
--
-- Returns the final upload status text. Useful for testing /
-- logs but the worker doesn't act on it.

CREATE OR REPLACE FUNCTION public.finalize_white_sheet_upload_if_done(upload_uuid UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  pending_or_processing INT;
  current_status TEXT;
BEGIN
  SELECT status INTO current_status
    FROM public.white_sheet_uploads
   WHERE id = upload_uuid
   FOR UPDATE;

  IF current_status IS NULL THEN
    RETURN NULL;  -- upload row doesn't exist
  END IF;

  IF current_status = 'complete' THEN
    RETURN current_status;  -- already done, no-op
  END IF;

  SELECT COUNT(*) INTO pending_or_processing
    FROM public.white_sheet_pages
   WHERE upload_id = upload_uuid
     AND status IN ('pending', 'processing');

  IF pending_or_processing > 0 THEN
    RETURN current_status;  -- still work to do
  END IF;

  UPDATE public.white_sheet_uploads
     SET status       = 'complete',
         completed_at = now()
   WHERE id = upload_uuid;

  RETURN 'complete';
END;
$$;

COMMENT ON FUNCTION public.finalize_white_sheet_upload_if_done(UUID) IS
  'If every page of the upload has reached a terminal status (auto_committed / needs_review / errored), flip the upload to complete + stamp completed_at. No-op otherwise. Idempotent. Phase 6 will hook a NOTIFY off this for the launcher counter + email summary.';


-- ─────────────────────────────────────────────────────────────
-- 3. Done
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  RAISE NOTICE 'White Sheet OCR Phase 3: claim_due_white_sheet_pages + finalize_white_sheet_upload_if_done installed. OCR worker can now drain pending pages safely under concurrent crons.';
END $$;
