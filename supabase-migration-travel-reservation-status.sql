-- ── Travel reservations: status + assignment columns
--
-- Adds two columns to travel_reservations:
--   status:               'pending' (someone's getting it) | 'booked' (done)
--   assigned_to_user_id:  who's handling the booking (e.g. "Tom getting car")
--
-- Existing rows default to 'booked' so the old "this is the booking"
-- assumption still holds.
--
-- Safe to re-run.
-- ============================================================

DO $$ BEGIN
  CREATE TYPE travel_reservation_status AS ENUM ('pending', 'booked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.travel_reservations
  ADD COLUMN IF NOT EXISTS status              travel_reservation_status NOT NULL DEFAULT 'booked',
  ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_travel_reservations_status
  ON public.travel_reservations (event_id, status)
  WHERE event_id IS NOT NULL;

DO $$ BEGIN
  RAISE NOTICE 'travel_reservations.status + assigned_to_user_id installed.';
END $$;
