-- Drop the `company` column from trunk_show_stores. Came in from the
-- import sheet (BEB / JLC / LIB) but isn't used anywhere in the app.
ALTER TABLE public.trunk_show_stores DROP COLUMN IF EXISTS company;

DO $$ BEGIN
  RAISE NOTICE 'trunk_show_stores.company column dropped.';
END $$;
