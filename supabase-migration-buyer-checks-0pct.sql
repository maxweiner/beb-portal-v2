-- ============================================================
-- buyer_checks: allow commission_rate = 0
--
-- The column is already smallint NOT NULL DEFAULT 10 and has no
-- CHECK constraint, so it already accepts 0. This migration only
-- updates the COMMENT to reflect the new domain. UI code rolls out
-- the third option in the parallel UI PR.
--
-- A check stamped commission_rate = 0 is "store purchase, no
-- commission" — tracked in buyer_checks for audit but excluded from
-- event_days.dollars_at_5pct / dollars_at_10pct (the derived sums in
-- DayEntry filter by exact rate, so 0 falls through). Reports surface
-- it as its own line so partners can see what was bought without
-- inflating the show's commission % math.
--
-- Safe to re-run.
-- ============================================================

COMMENT ON COLUMN buyer_checks.commission_rate
  IS 'Commission rate for this check: 10 (default) | 5 | 0. A 0 means "store purchase, no commission" — surfaced separately in reports, never rolled into event/show totals or commission % math.';

DO $$ BEGIN
  RAISE NOTICE 'buyer_checks.commission_rate now documents the 0 option.';
END $$;
