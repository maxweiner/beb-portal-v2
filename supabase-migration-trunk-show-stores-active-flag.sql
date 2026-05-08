-- ── trunk_show_stores: add `active` flag for dormant stores
--
-- Mirrors public.stores.active (which already exists). When false the
-- store is dormant — hidden from the default list views, but still
-- queryable via "Show inactive" toggles in the UI so it can be
-- reactivated later.
--
-- Distinct from the existing trunk_shows column on trunk_show_stores
-- (which means "this store IS a trunk-show partner" — a different
-- concept).
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE public.trunk_show_stores
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_trunk_show_stores_active_name
  ON public.trunk_show_stores (name)
  WHERE active = true;

DO $$ BEGIN
  RAISE NOTICE 'trunk_show_stores.active installed (default true).';
END $$;
