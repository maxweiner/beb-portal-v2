-- ============================================================
-- stores: rename owner_phone → owner_mobile_phone, backfill store_phone
--
-- Why
-- ---
-- Historically `stores.owner_phone` was populated from the Google
-- Places lookup during store creation — so the column was actually
-- holding the BUSINESS's phone, not the owner's personal mobile.
--
-- The user clarified the intent:
--   - `store_phone`         = the business's main public-facing line
--                              (auto-filled from Google Places)
--   - `owner_mobile_phone`  = the owner's personal cell
--                              (manually entered)
--
-- Migration steps
-- ---------------
-- 1. Backfill `store_phone` from `owner_phone` where store_phone is
--    NULL — preserves the Places-sourced phone that's been
--    accumulating in owner_phone.
-- 2. Rename column owner_phone → owner_mobile_phone.
--
-- Handles all four states defensively:
--   - only owner_phone exists                  → backfill + rename
--   - only owner_mobile_phone exists           → no-op (re-run)
--   - both exist (partial prior run)           → backfill from old
--                                                  if new is null, then
--                                                  drop old
--   - neither exists                           → add new column
--
-- Idempotent. Safe to re-run.
-- ============================================================

DO $$
DECLARE
  has_old BOOLEAN;
  has_new BOOLEAN;
  has_store_phone BOOLEAN;
BEGIN
  IF to_regclass('public.stores') IS NULL THEN
    RAISE NOTICE 'skip stores (table missing)';
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stores' AND column_name = 'owner_phone'
  ) INTO has_old;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stores' AND column_name = 'owner_mobile_phone'
  ) INTO has_new;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stores' AND column_name = 'store_phone'
  ) INTO has_store_phone;

  -- 1. Backfill store_phone from owner_phone where empty.
  IF has_old AND has_store_phone THEN
    EXECUTE '
      UPDATE public.stores
         SET store_phone = owner_phone
       WHERE store_phone IS NULL AND owner_phone IS NOT NULL
    ';
    RAISE NOTICE 'Backfilled store_phone from owner_phone where empty.';
  END IF;

  -- 2. Rename / add the column.
  IF has_old AND NOT has_new THEN
    EXECUTE 'ALTER TABLE public.stores RENAME COLUMN owner_phone TO owner_mobile_phone';
    RAISE NOTICE 'Renamed stores.owner_phone → stores.owner_mobile_phone';
  ELSIF NOT has_old AND NOT has_new THEN
    EXECUTE 'ALTER TABLE public.stores ADD COLUMN owner_mobile_phone TEXT';
    RAISE NOTICE 'Added stores.owner_mobile_phone (no old column to rename)';
  ELSIF has_old AND has_new THEN
    -- Both — backfill new from old where new is null, then drop old.
    EXECUTE '
      UPDATE public.stores
         SET owner_mobile_phone = owner_phone
       WHERE owner_mobile_phone IS NULL AND owner_phone IS NOT NULL
    ';
    EXECUTE 'ALTER TABLE public.stores DROP COLUMN owner_phone';
    RAISE NOTICE 'Both columns existed — copied old into new where new was null, dropped old.';
  ELSE
    RAISE NOTICE 'owner_mobile_phone already exists; owner_phone already gone. Nothing to do.';
  END IF;
END $$;
