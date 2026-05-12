-- ============================================================
-- stores: rename `quo_phone_number` → `beb_scheduling_phone`
--
-- The phone column added in supabase-migration-stores-phone-fields.sql
-- was labeled "QUO Telephone Number" in the UI; the user clarified
-- this should read "BEB Scheduling Tel #" instead. Renaming the
-- column to match keeps the UI label and the DB name in sync.
--
-- Handles three states defensively:
--   1. quo_phone_number exists, beb_scheduling_phone doesn't → rename
--   2. neither exists                                         → ADD the new one
--   3. both exist (partial prior run)                         → drop the old one
--
-- Idempotent. Safe to re-run.
-- ============================================================

DO $$
DECLARE
  has_old BOOLEAN;
  has_new BOOLEAN;
BEGIN
  IF to_regclass('public.stores') IS NULL THEN
    RAISE NOTICE 'skip stores (table missing)';
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stores' AND column_name = 'quo_phone_number'
  ) INTO has_old;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stores' AND column_name = 'beb_scheduling_phone'
  ) INTO has_new;

  IF has_old AND NOT has_new THEN
    EXECUTE 'ALTER TABLE public.stores RENAME COLUMN quo_phone_number TO beb_scheduling_phone';
    RAISE NOTICE 'Renamed stores.quo_phone_number → stores.beb_scheduling_phone';
  ELSIF NOT has_old AND NOT has_new THEN
    EXECUTE 'ALTER TABLE public.stores ADD COLUMN beb_scheduling_phone TEXT';
    RAISE NOTICE 'Added stores.beb_scheduling_phone (no old column to rename)';
  ELSIF has_old AND has_new THEN
    -- Both present — copy any non-null old values into new if new is
    -- empty, then drop old. Safer than blindly dropping.
    EXECUTE '
      UPDATE public.stores
         SET beb_scheduling_phone = quo_phone_number
       WHERE beb_scheduling_phone IS NULL AND quo_phone_number IS NOT NULL
    ';
    EXECUTE 'ALTER TABLE public.stores DROP COLUMN quo_phone_number';
    RAISE NOTICE 'Both columns existed — backfilled new from old, dropped old.';
  ELSE
    RAISE NOTICE 'beb_scheduling_phone already exists and quo_phone_number is gone — nothing to do.';
  END IF;
END $$;
