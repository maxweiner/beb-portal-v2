-- ============================================================
-- New 'accounting' role.
--
-- Accounting users are scoped to a specific slice of the portal:
-- Calendar (Appointments), Travel Share, Staff, Expenses. They do
-- NOT see Day Entry, Events, Reports, Admin, Stores, Dashboard,
-- Marketing, Shipping, Financials, or To-Do.
--
-- Sidebar restriction is enforced at the JS layer (similar to the
-- 'marketing' role). This migration only updates the role CHECK
-- constraint so the value is accepted at the DB level.
--
-- Safe to re-run.
-- ============================================================

DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE  conrelid = 'public.users'::regclass
      AND  contype  = 'c'
      AND  pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE public.users DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('buyer', 'admin', 'superadmin', 'pending', 'marketing', 'accounting'));

DO $$ BEGIN
  RAISE NOTICE 'accounting role installed.';
END $$;
