-- ── trunk_show_stores: add store_image_url for the logo
--
-- Mirrors public.stores.store_image_url. Stored as a base-64 data URL
-- to match the buying-event side. Long-term we'd move both to
-- Supabase Storage, but for now this gives parity.
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE public.trunk_show_stores
  ADD COLUMN IF NOT EXISTS store_image_url TEXT;

DO $$ BEGIN
  RAISE NOTICE 'trunk_show_stores.store_image_url installed.';
END $$;
