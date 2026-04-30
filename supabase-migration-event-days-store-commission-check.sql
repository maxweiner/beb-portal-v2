-- ============================================================
-- Day Entry: Day-3 store commission check capture.
--
-- At the end of every event the buyer pays the store a commission
-- check (one per event). We record the check number + amount on the
-- day-3 row of event_days so it travels with the day-entry record
-- and doesn't need a new table.
--
-- Important: these columns are RECORD-ONLY. They are deliberately
-- NOT folded into any aggregate column on event_days (purchases,
-- dollars10, dollars5, dollars0, customers, etc.) and the JS layer
-- excludes them from every total. They surface on the Event Recap
-- PDF for bookkeeping; that's it.
--
-- Both columns are nullable. Day 1 / Day 2 rows simply leave them
-- NULL — no UI is shown for those days. Safe to re-run.
-- ============================================================

ALTER TABLE event_days
  ADD COLUMN IF NOT EXISTS store_commission_check_number TEXT NULL;

ALTER TABLE event_days
  ADD COLUMN IF NOT EXISTS store_commission_check_amount NUMERIC(10,2) NULL
    CHECK (store_commission_check_amount IS NULL OR store_commission_check_amount >= 0);

COMMENT ON COLUMN event_days.store_commission_check_number IS
  'Day-3 only. Check # for the store commission paid at end-of-event. Record-only — never summed into totals.';
COMMENT ON COLUMN event_days.store_commission_check_amount IS
  'Day-3 only. Dollar amount of the store commission check. Record-only — never summed into totals.';

DO $$ BEGIN
  RAISE NOTICE 'event_days store_commission_check_* columns installed.';
END $$;
