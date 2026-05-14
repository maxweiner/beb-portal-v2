-- ============================================================
-- White Sheet OCR — PHASE 8: dedup-sweep schema additions
--
-- Adds one optional column to customer_dedup_review_queue so the
-- white-sheet OCR-drift sweep cron can flag near-miss duplicates
-- of EXISTING customers (not just CSV-import incoming data).
--
-- The existing import path uses customer_dedup_review_queue with:
--   - existing_customer_id  → the customer the incoming data MIGHT
--                             duplicate
--   - incoming_data         → JSONB snapshot of the (NEW, never-
--                             inserted) row to merge
--
-- OCR-drift is asymmetric: BOTH the existing and the duplicate
-- are already in customers — the cron found two rows that look
-- like the same person. The new column lets us point at the
-- second customers row so the resolve route's 'merge' action can:
--   1. update the canonical row (existing_customer_id) with non-null
--      fields from the dupe
--   2. re-point any white_sheet_pages.customer_id from the dupe
--      to the canonical row
--   3. soft-delete the dupe (set deleted_at)
--
-- Without this column, 'merge' would just patch the existing row
-- and leave the dupe in place — the customer would still appear
-- twice in lookups.
--
-- Backwards compatible — the column is NULL for every existing
-- import-path row; resolve route only changes behavior when it's
-- set.
-- ============================================================

ALTER TABLE public.customer_dedup_review_queue
  ADD COLUMN IF NOT EXISTS incoming_customer_id UUID NULL
    REFERENCES public.customers(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_dedup_queue_incoming_customer
  ON public.customer_dedup_review_queue(incoming_customer_id)
  WHERE incoming_customer_id IS NOT NULL;

COMMENT ON COLUMN public.customer_dedup_review_queue.incoming_customer_id IS
  'Phase 8 OCR-drift sweep only. When set, the row represents a pair of EXISTING customers that look like duplicates (not a CSV-import suggestion). The resolve route''s ''merge'' action re-points FKs + soft-deletes this customer when this column is non-NULL; NULL preserves the original import-path behavior.';


-- ─────────────────────────────────────────────────────────────
-- Helper: enforce uniqueness on (existing, incoming) pending pairs
-- ─────────────────────────────────────────────────────────────
-- The sweep cron runs daily. Without this index a repeat sweep
-- could enqueue the same pair multiple times before an operator
-- resolves the first instance. Partial unique index keeps the
-- guarantee cheap (no impact on the import-path rows since they
-- all have incoming_customer_id IS NULL).

CREATE UNIQUE INDEX IF NOT EXISTS
  customer_dedup_queue_unique_pending_pair
  ON public.customer_dedup_review_queue(existing_customer_id, incoming_customer_id)
  WHERE incoming_customer_id IS NOT NULL AND status = 'pending';


-- ─────────────────────────────────────────────────────────────
-- Done
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  RAISE NOTICE 'White Sheet OCR Phase 8: customer_dedup_review_queue.incoming_customer_id installed. OCR-drift sweep cron can now surface dupe pairs without double-queueing.';
END $$;
