-- Fix the telnyx row duplication and prevent it from happening again.
--
-- Background: app/api/settings/sms-providers/route.ts upserts into the
-- `settings` table with onConflict: 'key'. That only works if there is a
-- UNIQUE constraint on `key`. Without it, repeated saves silently insert
-- duplicate rows, and the loader's `.maybeSingle()` then returns null for
-- the duplicated key — so the UI shows the field as unset even though
-- rows exist in the table.

-- 1. Wipe all telnyx rows so Max can re-enter the creds cleanly via the UI.
DELETE FROM settings WHERE key = 'telnyx';

-- 2. Deduplicate any other accidentally-duplicated keys (keep the newest
-- physical row per key). ctid is the Postgres physical row identifier;
-- when no updates/vacuum has occurred, higher ctid == newer insert.
DELETE FROM settings a
USING settings b
WHERE a.key = b.key
  AND a.ctid < b.ctid;

-- 3. Add the UNIQUE constraint so onConflict-upsert behaves correctly
-- from now on. Idempotent: skips if already present.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'settings_key_unique'
  ) THEN
    ALTER TABLE settings
      ADD CONSTRAINT settings_key_unique UNIQUE (key);
  END IF;
END $$;
