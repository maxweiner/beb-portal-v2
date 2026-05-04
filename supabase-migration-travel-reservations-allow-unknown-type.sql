-- ── Allow type='unknown' on travel_reservations ──────────────
-- The inbound webhook used to early-return without inserting when
-- Claude classified an email as 'unknown' — the reservation just
-- vanished. Now the route still inserts so the row lands in the
-- user's Unassigned queue for manual classification + placement.
--
-- Some legacy schema may have a CHECK constraint that only permits
-- ('flight','hotel','rental_car'). Drop it and replace with a
-- broader one that also accepts 'unknown'.
--
-- Safe to re-run.
-- ============================================================

DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE  conrelid = 'public.travel_reservations'::regclass
      AND  contype  = 'c'
      AND  pg_get_constraintdef(oid) ILIKE '%type%'
  LOOP
    EXECUTE format('ALTER TABLE public.travel_reservations DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.travel_reservations
  ADD CONSTRAINT travel_reservations_type_check
  CHECK (type IN ('flight', 'hotel', 'rental_car', 'unknown'));

DO $$ BEGIN
  RAISE NOTICE 'travel_reservations.type now accepts unknown — the inbound route can save unclassified emails to the Unassigned queue.';
END $$;
