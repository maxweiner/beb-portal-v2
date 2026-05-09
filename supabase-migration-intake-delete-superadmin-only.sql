-- ── customer_intakes: tighten DELETE policy to superadmin only ──
--
-- Previously admin + superadmin could delete intakes (set in
-- supabase-migration-multi-role-phase-3-rls.sql). Buy-form numbers
-- are globally unique forever, so deleting one frees that number for
-- reuse — that's a sensitive enough action that we want it
-- superadmin-only by default. The new /api/intake/[id] DELETE route
-- enforces the same check at the application layer.
--
-- Safe to re-run.
-- ============================================================

DROP POLICY IF EXISTS "Admins can delete intakes" ON customer_intakes;
DROP POLICY IF EXISTS customer_intakes_delete    ON customer_intakes;

CREATE POLICY customer_intakes_delete
  ON customer_intakes FOR DELETE
  TO authenticated
  USING (public.has_any_role('superadmin'));

DO $$ BEGIN
  RAISE NOTICE 'customer_intakes DELETE narrowed to superadmin only.';
END $$;
