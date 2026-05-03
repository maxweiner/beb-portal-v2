-- ── Travel Share: link reservations to trade shows ────────────
-- Adds optional trade_show_id to travel_reservations so the
-- inbound-travel-email pipeline + the Travel Share UI can show
-- hotel/flight/rental reservations attached to trade shows
-- (JCK Las Vegas, etc.) the same way they do for buying events.
--
-- Also adds lat/lon to trade_shows so the 25-mile match radius
-- works for trade-show venues, mirroring stores.lat/lon (PR 1 of
-- the travel-match initiative).
--
-- A reservation can attach to AT MOST one of (event_id,
-- trade_show_id). The matcher in PR 2 picks whichever wins; the
-- CHECK constraint stops drift from accidental double-assignment.
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE public.travel_reservations
  ADD COLUMN IF NOT EXISTS trade_show_id UUID NULL REFERENCES public.trade_shows(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_travel_reservations_trade_show
  ON public.travel_reservations (trade_show_id) WHERE trade_show_id IS NOT NULL;

-- Drop the old CHECK if a previous run named it differently,
-- then add the mutual-exclusion check.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.travel_reservations'::regclass
       AND conname  = 'travel_reservations_event_xor_trade_show'
  ) THEN
    ALTER TABLE public.travel_reservations
      DROP CONSTRAINT travel_reservations_event_xor_trade_show;
  END IF;
END $$;

ALTER TABLE public.travel_reservations
  ADD CONSTRAINT travel_reservations_event_xor_trade_show
  CHECK (event_id IS NULL OR trade_show_id IS NULL);

-- Trade-show coordinates for the radius matcher.
ALTER TABLE public.trade_shows
  ADD COLUMN IF NOT EXISTS lat NUMERIC(9, 6),
  ADD COLUMN IF NOT EXISTS lon NUMERIC(9, 6),
  ADD COLUMN IF NOT EXISTS geocoded_at TIMESTAMPTZ;

COMMENT ON COLUMN public.trade_shows.lat IS
  'Venue latitude, geocoded from venue_address/city/state. NULL until backfilled.';
COMMENT ON COLUMN public.trade_shows.lon IS
  'Venue longitude.';

-- ── travel_reservation_assignments — learning log ──────────────
-- Every manual placement of an unassigned reservation is logged
-- here. Captures the reservation's parsed signals (city, state,
-- dates, vendor, hotel address) alongside what the user picked
-- so a future Claude job can mine the patterns and suggest
-- automatic rules ("vendor=Marriott + city=Las Vegas → JCK trade
-- show", etc.).
CREATE TABLE IF NOT EXISTS public.travel_reservation_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id  UUID NOT NULL REFERENCES public.travel_reservations(id) ON DELETE CASCADE,
  assigned_by     UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  event_id        UUID NULL REFERENCES public.events(id) ON DELETE SET NULL,
  trade_show_id   UUID NULL REFERENCES public.trade_shows(id) ON DELETE SET NULL,
  -- Snapshot of the parser output at assignment time so the row
  -- still tells the full story even after the reservation is
  -- edited or deleted.
  parsed_vendor   TEXT NULL,
  parsed_city     TEXT NULL,
  parsed_state    TEXT NULL,
  parsed_address  TEXT NULL,
  travel_date     DATE NULL,
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (event_id IS NULL OR trade_show_id IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_travel_assignments_assigned_by
  ON public.travel_reservation_assignments (assigned_by);
CREATE INDEX IF NOT EXISTS idx_travel_assignments_reservation
  ON public.travel_reservation_assignments (reservation_id);
COMMENT ON TABLE public.travel_reservation_assignments IS
  'Audit log for manual placement of travel reservations. Used by a future Claude job to suggest auto-match rules from buyer behavior.';

ALTER TABLE public.travel_reservation_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS travel_assignments_read ON public.travel_reservation_assignments;
CREATE POLICY travel_assignments_read ON public.travel_reservation_assignments
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'superadmin')
    OR assigned_by = public.get_effective_user_id()
  );

DROP POLICY IF EXISTS travel_assignments_insert ON public.travel_reservation_assignments;
CREATE POLICY travel_assignments_insert ON public.travel_reservation_assignments
  FOR INSERT TO authenticated
  WITH CHECK (assigned_by = public.get_effective_user_id());

DO $$ BEGIN
  RAISE NOTICE 'Travel-share trade-show columns + assignment log installed. Run Geocode Trade Shows in Settings before relying on radius matching.';
END $$;
