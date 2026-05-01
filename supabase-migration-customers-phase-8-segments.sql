-- ============================================================
-- Customers module — PHASE 8: customer_segments (saved filters)
--
-- Stores admin-named filter sets that can be re-run as one-click
-- CSV exports. Both Win-Back's three predefined segments (built
-- client-side, not stored) and ad-hoc admin-saved segments live
-- through the same Marketing Export pipeline.
--
-- Filters JSONB matches the ExportFilters TypeScript shape (see
-- lib/customers/exportFilters.ts). Storing as JSONB instead of
-- exploded columns keeps the schema flexible as filters evolve.
--
-- Safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS customer_segments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT NULL,
  filters     JSONB NOT NULL,
  created_by  UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_segments_created ON customer_segments(created_at DESC);

COMMENT ON TABLE customer_segments IS
  'Admin-saved Marketing Export filter sets. Re-runnable from the Win-Back tab. Filters JSONB mirrors the ExportFilters TypeScript shape; the export pipeline (lib/customers/exportQuery.ts) reads it directly.';

-- updated_at trigger — re-uses the customers helper if present.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'customers_set_updated_at') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_customer_segments_updated_at ON customer_segments';
    EXECUTE 'CREATE TRIGGER trg_customer_segments_updated_at BEFORE UPDATE ON customer_segments FOR EACH ROW EXECUTE FUNCTION customers_set_updated_at()';
  END IF;
END $$;

-- RLS: admin-only, all actions. Buyers don't see saved segments.
ALTER TABLE customer_segments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_segments_admin ON customer_segments;
CREATE POLICY customer_segments_admin ON customer_segments
  FOR ALL USING (customers_actor_is_admin())
  WITH CHECK (customers_actor_is_admin());

DO $$ BEGIN
  RAISE NOTICE 'customer_segments table installed (admin-only RLS).';
END $$;
