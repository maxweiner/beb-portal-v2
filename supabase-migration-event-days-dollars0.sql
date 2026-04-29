-- ============================================================
-- event_days.dollars0 — daily aggregate for store-purchase, no-commission
--
-- Companion to the existing event_days.dollars10 and event_days.dollars5
-- columns. Holds the per-day total of "store purchase, no commission"
-- dollars (commission_rate = 0). Lets the quick-entry box at the top of
-- the Enter Day Data screen behave the same as the 5% / 10% boxes —
-- a writable scalar that auto-fills from the per-check rows on Submit.
--
-- buyer_checks rows where commission_rate = 0 stay as the audit trail.
--
-- CRITICAL: dollars0 is NEVER summed into event/show totals or
-- commission % math. Every aggregator already filters by exact rate
-- (dollars10 + dollars5 only), and this column does not change that.
-- Reports surface dollars0 as its own labeled line item.
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE event_days
  ADD COLUMN IF NOT EXISTS dollars0 numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN event_days.dollars0 IS
  'Daily aggregate of store-purchase / no-commission dollars (commission_rate = 0). NEVER summed into dollars10 + dollars5 or commission % math; surfaced separately in reports.';

DO $$ BEGIN
  RAISE NOTICE 'event_days.dollars0 added (NUMERIC NOT NULL DEFAULT 0).';
END $$;
