-- ── Performance: indexes for the hottest queries
--
-- pg_stat_statements snapshot (excluding the realtime line, which is
-- a system-level query we can't tune) ranks these as the heaviest
-- application queries:
--
--   #1  stores WHERE brand=? ORDER BY name          ~22% of time
--   #2  stores WHERE active=? ORDER BY name         ~7.5%
--   #3  trunk_show_stores ORDER BY name             ~2.5%
--   #4  stores WHERE id=?                           ~1%   (RLS-bound, indexes still help)
--   #5  users ORDER BY name                         ~0.8%
--   #6  booking_config WHERE store_id=?             ~0.5%
--   #7  trunk_shows … LEFT JOIN trunk_show_stores   ~0.4%
--
-- Composite + partial indexes below cover all of these. Used IF NOT
-- EXISTS so the migration is a no-op on already-indexed columns.
-- These are small tables (dozens to low-hundreds of rows) so the
-- ACCESS EXCLUSIVE lock from CREATE INDEX (without CONCURRENTLY) is
-- a few-millisecond blip, not a problem.
--
-- Safe to re-run.
-- ============================================================

-- stores: hot path is (brand, name) for the per-brand scope check + sort.
CREATE INDEX IF NOT EXISTS idx_stores_brand_name
  ON public.stores (brand, name);

-- stores: per-active filter + sort. Partial index on the truthy side
-- since "active = false" is rare and the planner already short-circuits
-- those rows for the common path.
CREATE INDEX IF NOT EXISTS idx_stores_active_name
  ON public.stores (name)
  WHERE active = true;

-- trunk_show_stores: paginated SELECT * ORDER BY name with no
-- predicate — a covering index on name lets the planner skip the
-- sort entirely.
CREATE INDEX IF NOT EXISTS idx_trunk_show_stores_name
  ON public.trunk_show_stores (name);

-- users: AppContext loads users sorted by name on most page hits.
CREATE INDEX IF NOT EXISTS idx_users_name
  ON public.users (name);

-- booking_config: looked up per-store on the dashboard / event card
-- pre-flight checks. store_id is the natural FK; ensure it's indexed.
CREATE INDEX IF NOT EXISTS idx_booking_config_store_id
  ON public.booking_config (store_id);

-- trunk_shows: the Schedule view's JOIN scans by store_id and filters
-- deleted_at IS NULL. Partial index keeps it tight.
CREATE INDEX IF NOT EXISTS idx_trunk_shows_store_id_active
  ON public.trunk_shows (store_id)
  WHERE deleted_at IS NULL;

-- role_modules: the role-management lookup is `WHERE role_id = ANY(...)`.
-- A (role_id, module_id) index supports both the lookup and any
-- subsequent filters by module.
CREATE INDEX IF NOT EXISTS idx_role_modules_role_module
  ON public.role_modules (role_id, module_id);

DO $$ BEGIN
  RAISE NOTICE 'Perf indexes installed. Run pg_stat_statements_reset() and watch the heavy-query board for the drop.';
END $$;
