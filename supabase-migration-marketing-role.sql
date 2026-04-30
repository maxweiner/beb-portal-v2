-- ============================================================
-- Single 'marketing' role (replaces marketing_partner from Phase 10).
--
-- Phase 10 introduced 'marketing_partner' for external Collected
-- accounts. The user has consolidated: one role 'marketing' covers
-- both internal Marketing Team members AND external Collected users
-- — both see Calendar + Marketing in the sidebar and nothing else.
--
-- Migration steps:
--   1. Migrate any existing role='marketing_partner' rows to 'marketing'.
--   2. Drop the existing role CHECK (constraint name discovered
--      dynamically) and re-add it without 'marketing_partner'.
--
-- Safe to re-run.
-- ============================================================

UPDATE public.users SET role = 'marketing' WHERE role = 'marketing_partner';

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
  CHECK (role IN ('buyer', 'admin', 'superadmin', 'pending', 'marketing'));

DO $$ BEGIN
  RAISE NOTICE 'Single marketing role installed; marketing_partner retired.';
END $$;
