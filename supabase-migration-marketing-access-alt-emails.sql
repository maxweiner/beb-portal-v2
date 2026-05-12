-- ── Fix: has_marketing_access() also honors alternate_emails ─
-- The original definition (supabase-migration-marketing-phase-1-schema.sql)
-- joins auth.users → public.users by primary email only:
--
--   JOIN auth.users au ON au.email = u.email
--   WHERE au.id = auth.uid()
--
-- This silently denies marketing access to any user who signs in
-- with one of their alternate emails (public.users.alternate_emails)
-- instead of their primary. The API layer (lib/expenses/serverAuth.ts
-- getAuthedUser) already checks both lists; the RLS function did not.
--
-- Concrete repro: Teri Welsch's public.users.email is teri@bebllp.com
-- with teriwelsch@gmail.com listed in alternate_emails. She signs in
-- as teriwelsch@gmail.com daily; the primary-email-only join missed
-- her row and the function returned FALSE despite her marketing_access
-- column being TRUE.
--
-- Fix: rewrite the join to filter on auth.uid() first, then match
-- either primary OR alternate emails. Same SECURITY DEFINER /
-- STABLE attributes preserved.
--
-- Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION has_marketing_access() RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT u.marketing_access
       FROM public.users u
       JOIN auth.users au ON au.id = auth.uid()
      WHERE au.email = u.email
         OR au.email = ANY(COALESCE(u.alternate_emails, ARRAY[]::TEXT[]))
      LIMIT 1),
    FALSE
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION has_marketing_access() IS
  'Returns true when the calling Supabase Auth user has marketing_access=true on their users row. Matches on primary email OR any alternate_emails entry (so users who sign in with an alt email still resolve correctly).';

DO $$ BEGIN
  RAISE NOTICE 'has_marketing_access() updated to honor alternate_emails.';
END $$;
