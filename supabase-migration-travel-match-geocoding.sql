-- ── Travel-match geocoding (PR 1: schema) ─────────────────────
-- Adds lat/lon columns to stores and travel_reservations so the
-- inbound-travel-email pipeline (PR 3) can filter candidate
-- events by hotel-to-store distance instead of just text-matching
-- city/state.
--
-- PR 2 will add the admin-triggered backfill that populates
-- stores.lat/lon for existing rows via the Google Geocoding API.
--
-- Settings:
--   travel.match_radius_miles — max hotel-to-store distance for an
--   automatic match. Default 25. Tunable per the user's request.
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS lat NUMERIC(9, 6),
  ADD COLUMN IF NOT EXISTS lon NUMERIC(9, 6),
  ADD COLUMN IF NOT EXISTS geocoded_at TIMESTAMPTZ;

COMMENT ON COLUMN public.stores.lat IS
  'Latitude in decimal degrees, geocoded from address. NULL until backfill runs (PR 2).';
COMMENT ON COLUMN public.stores.lon IS
  'Longitude in decimal degrees, geocoded from address.';
COMMENT ON COLUMN public.stores.geocoded_at IS
  'When the lat/lon was last refreshed. Used by the backfill job to skip recently-geocoded rows.';

ALTER TABLE public.travel_reservations
  ADD COLUMN IF NOT EXISTS lat NUMERIC(9, 6),
  ADD COLUMN IF NOT EXISTS lon NUMERIC(9, 6),
  ADD COLUMN IF NOT EXISTS geocoded_at TIMESTAMPTZ;

COMMENT ON COLUMN public.travel_reservations.lat IS
  'Hotel latitude, geocoded from details->>address at insert time. Only populated for type=hotel; flights and rentals stay NULL.';
COMMENT ON COLUMN public.travel_reservations.lon IS
  'Hotel longitude, geocoded from details->>address.';

INSERT INTO public.settings (key, value)
VALUES ('travel.match_radius_miles', '25')
ON CONFLICT (key) DO NOTHING;

DO $$ BEGIN
  RAISE NOTICE 'Travel-match geocoding columns installed. Stores/reservations have lat/lon — populate via PR 2 backfill.';
END $$;
