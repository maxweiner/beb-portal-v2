-- ============================================================
-- Day Entry: Quick Mode aggregate columns
-- Run this in the Supabase SQL Editor before deploying the
-- rewritten MobileDayEntry component.
--
-- Adds three nullable columns to buyer_entries so the mobile
-- Quick-mode form can capture day totals without requiring
-- per-check detail. Detailed mode still populates buyer_checks
-- (unchanged). Existing rows remain valid — all columns nullable.
-- ============================================================

ALTER TABLE buyer_entries
  ADD COLUMN IF NOT EXISTS purchases_made   int,
  ADD COLUMN IF NOT EXISTS dollars_at_10pct numeric(10,2),
  ADD COLUMN IF NOT EXISTS dollars_at_5pct  numeric(10,2);

COMMENT ON COLUMN buyer_entries.purchases_made
  IS 'Number of purchases for the day (direct-entered by buyer in Quick mode).';
COMMENT ON COLUMN buyer_entries.dollars_at_10pct
  IS 'Total dollars spent by customers on items with 10% commission rate.';
COMMENT ON COLUMN buyer_entries.dollars_at_5pct
  IS 'Total dollars spent by customers on items with 5% commission rate.';
