-- ============================================================
-- White Sheet OCR — PHASE 6: completion notification gating
--
-- Lets the worker fire-once an email summary when an upload
-- transitions to 'complete'. Two pieces:
--
--   1. Add white_sheet_uploads.notification_sent_at TIMESTAMPTZ —
--      stamped by the worker after the email goes out so retries /
--      duplicate cron firings can't double-send.
--
--   2. Update finalize_white_sheet_upload_if_done to return a
--      richer string so callers can distinguish:
--        - 'just_finalized'   — this call did the status transition
--        - 'already_complete' — upload was already complete on entry
--        - the upload's current status (still processing / splitting)
--
--      Same gate as before (only flips when every page has settled),
--      but the new return value lets the worker know whether IT was
--      the one that closed the upload, which is the only safe moment
--      to fire the email.
--
-- Spec: docs/white-sheet-ocr-spec.md
-- Safe to re-run. Idempotent.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. notification_sent_at column
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.white_sheet_uploads
  ADD COLUMN IF NOT EXISTS notification_sent_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.white_sheet_uploads.notification_sent_at IS
  'Stamped by the OCR worker after the completion email + in-app notification fired. The worker reads this before sending so retries / duplicate cron firings cannot double-send. NULL = not yet sent.';


-- ─────────────────────────────────────────────────────────────
-- 2. finalize_white_sheet_upload_if_done v2
-- ─────────────────────────────────────────────────────────────
-- Same locking + check semantics; the only change is the return
-- value distinguishing 'just_finalized' from 'already_complete'.

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
    -- Already done; let the caller know it was a no-op so it
    -- doesn't try to fire the email a second time.
    RETURN 'already_complete';
  END IF;

  SELECT COUNT(*) INTO pending_or_processing
    FROM public.white_sheet_pages
   WHERE upload_id = upload_uuid
     AND status IN ('pending', 'processing');

  IF pending_or_processing > 0 THEN
    RETURN current_status;  -- still work to do — 'splitting' or 'processing'
  END IF;

  UPDATE public.white_sheet_uploads
     SET status       = 'complete',
         completed_at = now()
   WHERE id = upload_uuid;

  -- 'just_finalized' is the worker's signal to fire the email.
  -- We deliberately don't touch notification_sent_at here — the
  -- worker stamps it after the email send returns, so a crash
  -- between this RPC and the send leaves notification_sent_at
  -- NULL and the next worker cycle re-attempts the send.
  RETURN 'just_finalized';
END;
$$;

COMMENT ON FUNCTION public.finalize_white_sheet_upload_if_done(UUID) IS
  'If every page of the upload has reached a terminal status (auto_committed / needs_review / errored), flip the upload to complete + stamp completed_at, returning ''just_finalized''. Returns ''already_complete'' on no-op. Returns the current status (splitting/processing) when still in progress. Workers use the ''just_finalized'' signal to fire-once the completion email + in-app notification.';


-- ─────────────────────────────────────────────────────────────
-- 3. Done
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  RAISE NOTICE 'White Sheet OCR Phase 6: notification_sent_at column + finalize RPC v2 installed. Worker can now fire-once the completion email when an upload settles.';
END $$;
