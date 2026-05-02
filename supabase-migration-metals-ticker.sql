-- ============================================================
-- Metals Price Ticker — buyer dashboard
--
-- Caches gold/silver/platinum spot prices fetched from a
-- third-party API. The cron at /api/cron/metals-prices-refresh
-- upserts rows here every 15 minutes; the dashboard reads
-- straight from the table.
--
-- Layout decisions:
--   - Primary key = metal so upsert is a clean ON CONFLICT.
--   - Three rows total; the cache never grows.
--   - previous_close_usd is set once per UTC day (at the first
--     successful refresh of the day) so the cron doesn't have
--     to remember stale rows. The corresponding % change is
--     computed at write time and stored alongside the price so
--     the client doesn't have to do math.
--
-- Read access: any authenticated user. Writes: service role only.
-- (No INSERT / UPDATE policies — the upsert from API routes uses
--  the service-role client.)
--
-- Safe to re-run.
-- ============================================================

DO $$ BEGIN
  CREATE TYPE metal_kind AS ENUM ('gold', 'silver', 'platinum');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS metals_prices_cache (
  metal                   metal_kind PRIMARY KEY,
  price_usd_per_oz        NUMERIC(12,4)    NOT NULL CHECK (price_usd_per_oz > 0),
  change_percent_24h      NUMERIC(7,4),
  previous_close_usd      NUMERIC(12,4),
  previous_close_set_at   TIMESTAMPTZ,
  fetched_at              TIMESTAMPTZ      NOT NULL DEFAULT now(),
  source                  TEXT             NOT NULL
);

ALTER TABLE metals_prices_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS metals_prices_cache_read ON metals_prices_cache;
CREATE POLICY metals_prices_cache_read ON metals_prices_cache
  FOR SELECT TO authenticated
  USING (true);

DO $$ BEGIN
  RAISE NOTICE 'metals_prices_cache table installed.';
END $$;
