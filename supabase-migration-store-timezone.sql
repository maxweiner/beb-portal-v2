-- ============================================================
-- Adds a per-store timezone for the appointment system.
-- Used by the reminder cron to compute the actual UTC moment of an
-- appointment (which is stored as date + local time-of-day).
--
-- Default 'America/New_York' since that's where most BEB shows are.
-- Edit per store in the admin UI.
-- ============================================================

ALTER TABLE stores ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/New_York';

-- Backfill any existing rows (default only applies to new inserts)
UPDATE stores SET timezone = 'America/New_York' WHERE timezone IS NULL;
