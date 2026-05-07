-- ── Events RLS: ensure admins/superadmins/partners can INSERT/UPDATE
-- Repro: creating a new buying event from the new view returned
--   "new row violates row-level security policy for table 'events'"
-- The events table has a SELECT/DELETE policy in our local migrations
-- but the INSERT/UPDATE side was either missing or too restrictive.
-- This migration drops + re-adds explicit INSERT and UPDATE policies
-- granting access to admin/superadmin (via the existing
-- has_any_role helper) plus partners.
--
-- Read access: NOT touched here. If reads are working, the existing
-- SELECT policy is fine.
--
-- Safe to re-run.
-- ============================================================

-- 1. INSERT — admin/superadmin/partner only.
DROP POLICY IF EXISTS events_insert ON public.events;
CREATE POLICY events_insert ON public.events
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role('admin', 'superadmin')
    OR COALESCE(
        (SELECT u.is_partner FROM public.users u WHERE u.id = public.get_effective_user_id()),
        FALSE
    )
  );

-- 2. UPDATE — same gate. Buyers don't edit events directly; they
--    update day rows + buyer_entries which have their own policies.
DROP POLICY IF EXISTS events_update ON public.events;
CREATE POLICY events_update ON public.events
  FOR UPDATE TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR COALESCE(
        (SELECT u.is_partner FROM public.users u WHERE u.id = public.get_effective_user_id()),
        FALSE
    )
  )
  WITH CHECK (
    public.has_any_role('admin', 'superadmin')
    OR COALESCE(
        (SELECT u.is_partner FROM public.users u WHERE u.id = public.get_effective_user_id()),
        FALSE
    )
  );

DO $$ BEGIN
  RAISE NOTICE 'events INSERT + UPDATE policies installed for admin/superadmin/partner.';
END $$;
