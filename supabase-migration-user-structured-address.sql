-- ============================================================
-- Users — structured home address columns
--
-- Adds line1/line2/city/state/zip alongside the existing
-- `home_address` text blob so prefills into the W-9 form (and any
-- future structured-address surface) can land in the right slots
-- instead of dumping the whole address into Line 1.
--
-- `home_address` stays as the assembled single-line view — populated
-- from the structured fields by the Settings save handler and read
-- by the mileage calculator (which feeds the string straight to the
-- Distance Matrix API, where a one-line address is fine). No
-- generated column or trigger here; client-side assembly keeps the
-- migration small and avoids breaking existing INSERT paths.
--
-- No backfill. Existing rows keep their `home_address` text; their
-- new columns stay NULL. The Settings UI will offer the
-- Google Places autocomplete so users populate the structured
-- columns the next time they edit their profile.
--
-- Idempotent. Safe to re-run.
-- ============================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS home_address_line1 TEXT,
  ADD COLUMN IF NOT EXISTS home_address_line2 TEXT,
  ADD COLUMN IF NOT EXISTS home_city          TEXT,
  ADD COLUMN IF NOT EXISTS home_state         TEXT,
  ADD COLUMN IF NOT EXISTS home_zip           TEXT;

COMMENT ON COLUMN public.users.home_address_line1 IS
  'Street number + street name + apt/suite. Filled by Google Places autocomplete on the Settings profile form; W-9 form prefills from this.';
COMMENT ON COLUMN public.users.home_address_line2 IS
  'Optional second line (rare — apartment / suite that Places didn''t capture).';

DO $$ BEGIN
  RAISE NOTICE 'Structured user-address columns added. No backfill — existing home_address text stays; users repopulate the structured columns via Settings → Profile.';
END $$;
