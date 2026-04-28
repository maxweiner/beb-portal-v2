-- ============================================================
-- Add per-buyer purchase counts to event_days.
--
-- Stored as JSONB keyed by user_id so the schema doesn't need to
-- change for new buyers — just add another key:
--   { "user-uuid-1": 5, "user-uuid-2": 3 }
--
-- Blank input from the UI = key absent from the object (NOT a 0
-- value), so "not entered yet" stays distinguishable from
-- "zero purchases".
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE event_days
  ADD COLUMN IF NOT EXISTS purchases_by_buyer JSONB NOT NULL DEFAULT '{}'::jsonb;
