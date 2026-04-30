-- ============================================================
-- Marketing Phase 10: marketing_partner role for external Collected
-- accounts.
--
-- These users have a real BEB Portal login but only see the Marketing
-- module. The role is added to whatever CHECK constraint already
-- governs users.role (constraint name discovered dynamically — Supabase
-- projects tend to name it users_role_check but we don't depend on it).
--
-- Safe to re-run.
-- ============================================================

DO $$
DECLARE
  c RECORD;
BEGIN
  -- Drop any existing CHECK constraint on users that references 'role'.
  FOR c IN
    SELECT conname
    FROM   pg_constraint
    WHERE  conrelid = 'public.users'::regclass
      AND  contype  = 'c'
      AND  pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE public.users DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('buyer', 'admin', 'superadmin', 'pending', 'marketing_partner'));

DO $$ BEGIN
  RAISE NOTICE 'marketing_partner role value installed.';
END $$;
