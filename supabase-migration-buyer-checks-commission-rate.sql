-- ============================================================
-- buyer_checks: per-check commission rate
-- Run this in the Supabase SQL Editor BEFORE deploying the
-- matching MobileDayEntry update.
--
-- Adds a commission_rate column so the Detailed check entry can
-- tag each check as 10% (default) or 5%. The mobile form then
-- totals amounts by rate and fills the $ @ 10% / $ @ 5% fields
-- automatically.
--
-- Existing rows default to 10. Future scanner ScanBuy.commissionRate
-- writes into this column directly.
-- ============================================================

ALTER TABLE buyer_checks
  ADD COLUMN IF NOT EXISTS commission_rate smallint NOT NULL DEFAULT 10;

COMMENT ON COLUMN buyer_checks.commission_rate
  IS 'Commission rate for this check: 10 (default) or 5.';
