-- ============================================================
-- Marketing payments — support unpaid items.
--
-- Old model: every row was a paid payment. paid_at NOT NULL was
-- the "when this cost happened" date.
--
-- New model: a row is a "cost" that may or may not be paid yet.
--   - incurred_at  — required, when the cost happened (invoice date)
--   - paid_at      — optional, when the check actually cleared
--   - payment_method_id — optional, set when paid
--
-- Backfill: incurred_at <- paid_at for every existing row (they
-- were all paid, so the two dates coincide).
--
-- Safe to re-run.
-- ============================================================

-- 1. Add incurred_at, backfill, then enforce NOT NULL
ALTER TABLE marketing_payments
  ADD COLUMN IF NOT EXISTS incurred_at DATE;

UPDATE marketing_payments
  SET incurred_at = paid_at
  WHERE incurred_at IS NULL;

ALTER TABLE marketing_payments
  ALTER COLUMN incurred_at SET NOT NULL;

-- 2. paid_at can now be null
ALTER TABLE marketing_payments
  ALTER COLUMN paid_at DROP NOT NULL;

-- 3. Indexes for the new sort/filter paths
CREATE INDEX IF NOT EXISTS idx_marketing_payments_incurred_at
  ON marketing_payments(incurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketing_payments_unpaid
  ON marketing_payments(event_id) WHERE paid_at IS NULL;
