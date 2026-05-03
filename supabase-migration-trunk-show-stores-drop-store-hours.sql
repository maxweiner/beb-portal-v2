-- Drop the `store_hours` column from trunk_show_stores. Came in from
-- the import sheet but isn't used anywhere; the trunk_show_hours table
-- (per-day hours on an actual show) is the operational source of truth.
ALTER TABLE public.trunk_show_stores DROP COLUMN IF EXISTS store_hours;

DO $$ BEGIN
  RAISE NOTICE 'trunk_show_stores.store_hours column dropped.';
END $$;
