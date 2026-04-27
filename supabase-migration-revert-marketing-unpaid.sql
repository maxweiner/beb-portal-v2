-- ============================================================
-- DOWN-migration for the unpaid-costs work (PR #57).
-- Mirrors the original supabase-migration-marketing-unpaid.sql in
-- reverse, plus a safety backfill so any unpaid rows added between
-- shipping and reverting don't block the NOT NULL restore.
--
-- Net effect after running:
--   - paid_at:    nullable  →  NOT NULL again
--   - incurred_at: gone
--   - new indexes from #57: dropped
--
-- Any unpaid row (paid_at IS NULL) gets paid_at = incurred_at so
-- the date is preserved. payment_method_id stays null on those
-- rows — clean those up manually if you want.
--
-- Safe to re-run.
-- ============================================================

-- 1. Backfill unpaid rows so the NOT NULL restore can succeed
DO $$
DECLARE
  unpaid_count INT;
BEGIN
  SELECT COUNT(*) INTO unpaid_count
  FROM marketing_payments
  WHERE paid_at IS NULL;

  IF unpaid_count > 0 THEN
    UPDATE marketing_payments
      SET paid_at = incurred_at
      WHERE paid_at IS NULL;
    RAISE NOTICE 'Backfilled paid_at = incurred_at on % unpaid row(s).', unpaid_count;
  ELSE
    RAISE NOTICE 'No unpaid rows to backfill.';
  END IF;
END $$;

-- 2. Restore paid_at NOT NULL
ALTER TABLE marketing_payments
  ALTER COLUMN paid_at SET NOT NULL;

-- 3. Drop the indexes added by #57
DROP INDEX IF EXISTS idx_marketing_payments_incurred_at;
DROP INDEX IF EXISTS idx_marketing_payments_unpaid;

-- 4. Drop incurred_at
ALTER TABLE marketing_payments
  DROP COLUMN IF EXISTS incurred_at;
