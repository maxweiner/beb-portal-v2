-- ============================================================
-- Add "Hold at Home Office" as a distinct dropdown option that
-- behaves the same as "No Hold" — no shipment, no calendar entry,
-- no email. Stored as a separate boolean so we can show the right
-- label in the UI without overloading hold_time_days.
--
-- Combinations:
--   hold_time_days NULL, hold_at_home_office FALSE → "No Hold"
--   hold_time_days NULL, hold_at_home_office TRUE  → "Hold at Home Office"
--   hold_time_days = N, hold_at_home_office FALSE  → "N Days"
--
-- Existing triggers already early-return when hold_time_days IS NULL,
-- so no logic changes are needed — the new flag is presentational.
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS hold_at_home_office BOOLEAN NOT NULL DEFAULT false;

-- Defensive: a store can't both have a numeric hold AND home-office set.
ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_hold_mode_consistent;
ALTER TABLE stores ADD CONSTRAINT stores_hold_mode_consistent
  CHECK (NOT (hold_time_days IS NOT NULL AND hold_at_home_office));
