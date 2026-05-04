-- ── Per-rep slot capacity for trunk shows ─────────────────────
--
-- Today: trunk_show_appointment_slots is the booking record itself
-- (status, customer info, purchased flag all live on the slot row).
-- Once 2pm is "booked", no one else can take 2pm.
--
-- New model: a slot is just a time block. Each booking is a separate
-- row in trunk_show_slot_bookings, attached to the slot AND the
-- token (rep) the customer booked through. With N active links you
-- get N effective lanes per slot — each rep can fill their own.
--
-- We're not live yet, so this is a clean drop + recreate. No data
-- migration needed; existing test bookings will be wiped.
--
-- After this:
--   trunk_show_appointment_slots → time blocks only
--   trunk_show_slot_bookings     → customer bookings (1 per slot+token)
--   trunk_show_spiffs            → references slot_booking_id
--
-- Safe to re-run.
-- ============================================================

-- 1. Wipe any test bookings + spiffs so the column drops don't trip
--    over data and so we start clean.
TRUNCATE TABLE public.trunk_show_spiffs CASCADE;

-- 2. New bookings table.
CREATE TABLE IF NOT EXISTS public.trunk_show_slot_bookings (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id                     UUID NOT NULL REFERENCES public.trunk_show_appointment_slots(id) ON DELETE CASCADE,
  booking_token_id            UUID NULL REFERENCES public.trunk_show_booking_tokens(id) ON DELETE SET NULL,
  customer_first_name         TEXT NOT NULL,
  customer_last_name          TEXT,
  customer_email              TEXT,
  customer_phone              TEXT,
  store_salesperson_name      TEXT,
  notes                       TEXT,
  status                      TEXT NOT NULL DEFAULT 'booked'
    CHECK (status IN ('booked', 'cancelled', 'completed', 'no_show')),
  purchased                   BOOLEAN NOT NULL DEFAULT FALSE,
  purchased_marked_by         UUID REFERENCES public.users(id) ON DELETE SET NULL,
  purchased_marked_at         TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trunk_show_slot_bookings_slot
  ON public.trunk_show_slot_bookings (slot_id);
CREATE INDEX IF NOT EXISTS idx_trunk_show_slot_bookings_token
  ON public.trunk_show_slot_bookings (booking_token_id) WHERE booking_token_id IS NOT NULL;

-- The per-rep capacity rule: at most one booking per (slot, token).
-- Bookings without a token (rep-direct manual bookings) are bounded
-- separately by the panel UI.
CREATE UNIQUE INDEX IF NOT EXISTS uq_trunk_show_slot_bookings_slot_token
  ON public.trunk_show_slot_bookings (slot_id, booking_token_id)
  WHERE booking_token_id IS NOT NULL;

ALTER TABLE public.trunk_show_slot_bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trunk_show_slot_bookings_read ON public.trunk_show_slot_bookings;
CREATE POLICY trunk_show_slot_bookings_read ON public.trunk_show_slot_bookings
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
    OR EXISTS (
      SELECT 1 FROM public.trunk_show_appointment_slots s
      JOIN public.trunk_shows ts ON ts.id = s.trunk_show_id
      WHERE s.id = trunk_show_slot_bookings.slot_id
        AND ts.assigned_rep_id = public.get_effective_user_id()
    )
  );

DROP POLICY IF EXISTS trunk_show_slot_bookings_write ON public.trunk_show_slot_bookings;
CREATE POLICY trunk_show_slot_bookings_write ON public.trunk_show_slot_bookings
  FOR ALL TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
  )
  WITH CHECK (
    public.get_my_role() IN ('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
  );

-- 3. Slot table is now a pure time block. Drop the booking columns.
ALTER TABLE public.trunk_show_appointment_slots
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS customer_first_name,
  DROP COLUMN IF EXISTS customer_last_name,
  DROP COLUMN IF EXISTS customer_email,
  DROP COLUMN IF EXISTS customer_phone,
  DROP COLUMN IF EXISTS store_salesperson_name,
  DROP COLUMN IF EXISTS booking_token_id,
  DROP COLUMN IF EXISTS purchased,
  DROP COLUMN IF EXISTS purchased_marked_by,
  DROP COLUMN IF EXISTS purchased_marked_at,
  DROP COLUMN IF EXISTS notes;

-- 4. Spiffs reference the booking now, not the slot.
ALTER TABLE public.trunk_show_spiffs
  DROP COLUMN IF EXISTS appointment_slot_id;
ALTER TABLE public.trunk_show_spiffs
  ADD COLUMN IF NOT EXISTS slot_booking_id UUID NULL
    REFERENCES public.trunk_show_slot_bookings(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_trunk_show_spiffs_booking
  ON public.trunk_show_spiffs (slot_booking_id) WHERE slot_booking_id IS NOT NULL;

DO $$ BEGIN
  RAISE NOTICE 'Trunk show bookings model installed: slots are pure time blocks; trunk_show_slot_bookings holds per-rep customer bookings; spiffs reference slot_booking_id.';
END $$;
