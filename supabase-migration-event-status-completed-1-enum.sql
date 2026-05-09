-- ── events.status: add 'completed' value ──
--
-- Step 1 of 2. Adds 'completed' to the event_status enum so a past
-- buying event with a full 3 days of data can transition out of
-- 'scheduled'. Step 2 (-backfill.sql) flips qualifying existing rows.
-- Two files because Postgres won't let us USE a freshly-added enum
-- value in the same transaction that adds it.
--
-- Status model post-migration:
--   reserved   — Save the Date, not yet confirmed
--   scheduled  — booked / future / in progress
--   completed  — past + 3 days of entered data (new)
--   cancelled  — explicitly cancelled
--
-- Safe to re-run.
-- ============================================================

ALTER TYPE event_status ADD VALUE IF NOT EXISTS 'completed';

DO $$ BEGIN
  RAISE NOTICE 'event_status now includes ''completed''. Run the -backfill.sql file next to promote qualifying past events.';
END $$;
