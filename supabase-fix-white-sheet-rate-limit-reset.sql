-- ============================================================
-- One-shot fix: reset rate-limited white-sheet pages back to pending
--
-- On 2026-05-15 the OCR cron started processing pages but every
-- request 429'd against Anthropic's 30K-tokens-per-minute org cap
-- because the worker fires 8 in parallel and each page is ~4K
-- tokens (8 × 4K = 32K → over). The companion code change drops
-- BATCH_SIZE 8 → 3 (3 × 4K = 12K, well under), and we also
-- special-case 429 in the worker so the page stays pending instead
-- of going errored.
--
-- This SQL un-errors every page that was hit by the rate limit so
-- they get re-claimed on the next cron tick. Filter is strict on
-- 'rate_limit_error' to avoid touching pages that errored for
-- other reasons (PDF download fail, etc.) — those need separate
-- diagnosis.
--
-- Side effect: attempts is NOT reset. We want the running tally
-- preserved so cron logs / future debugging still show the row
-- has been processed before. The next tick will increment again.
--
-- Safe to re-run. Idempotent.
-- ============================================================

UPDATE public.white_sheet_pages
   SET status = 'pending',
       last_error = NULL
 WHERE status = 'errored'
   AND last_error LIKE '%rate_limit_error%';

DO $$
DECLARE
  v_pending INT;
BEGIN
  SELECT COUNT(*) INTO v_pending
    FROM public.white_sheet_pages
   WHERE status = 'pending';
  RAISE NOTICE 'Rate-limited pages reset to pending. % total pages now waiting for OCR.', v_pending;
END $$;
