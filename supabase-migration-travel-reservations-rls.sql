-- ============================================================
-- travel_reservations — lock down with RLS
--
-- Until now this table had RLS disabled, so anyone (including
-- anonymous PostgREST callers) could read flight / hotel /
-- rental_car reservations along with vendor names, confirmation
-- numbers, and the raw inbound-email bodies in `raw_email`.
--
-- New policy:
--   SELECT  — owner of the reservation OR admin / superadmin
--   INSERT  — none (server routes use service role; bypasses RLS)
--   UPDATE  — none (same)
--   DELETE  — none (same)
--
-- Owner is resolved via public.get_effective_user_id() so the
-- "View As" impersonation feature works correctly here too.
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE travel_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS travel_reservations_read ON travel_reservations;
CREATE POLICY travel_reservations_read ON travel_reservations
  FOR SELECT TO authenticated
  USING (
    travel_reservations.buyer_id = public.get_effective_user_id()
    OR public.get_my_role() IN ('admin','superadmin')
  );

DO $$ BEGIN
  RAISE NOTICE 'travel_reservations RLS enabled. SELECT scoped to owner + admin/superadmin.';
END $$;
