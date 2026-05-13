-- ============================================================
-- Fix: can_act_as_expense_owner() — use get_effective_user_id()
--
-- The version shipped in supabase-migration-expense-delegates-rls.sql
-- did its own inline `WHERE u.email = auth.jwt()->>'email'` lookup
-- (no lower(), no auth_id fallback). Any user whose JWT email
-- doesn't case-perfectly match their public.users.email — or who
-- logs in via an alternate email that routes to a canonical row
-- — gets EXISTS() = false, so the expense_reports INSERT policy
-- rejects them with:
--
--   "new row violates row-level security policy for table
--    expense_reports"
--
-- Even when they're trying to create their OWN report.
--
-- This is the exact failure mode the site-wide RLS tightening
-- (PR #582, 2026-05-12) addressed: new code must route through
-- the auth_id-first helper get_effective_user_id() rather than
-- inline email matching. My delegates RLS migration regressed
-- against that convention; fixing now.
--
-- Behavior change: none. The function still returns true when
-- the caller IS the target user OR an active delegate. The
-- difference is *how* "caller" is resolved — auth_id-first (via
-- get_effective_user_id()) instead of brittle email-match.
--
-- Idempotent (CREATE OR REPLACE). Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public.can_act_as_expense_owner(target_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    public.get_effective_user_id() = target_user_id
    OR EXISTS (
      SELECT 1
      FROM public.expense_delegates ed
      WHERE ed.delegate_user_id  = public.get_effective_user_id()
        AND ed.principal_user_id = target_user_id
        AND ed.revoked_at IS NULL
    );
$$;

GRANT EXECUTE ON FUNCTION public.can_act_as_expense_owner(uuid) TO authenticated, anon;

DO $$ BEGIN
  RAISE NOTICE 'can_act_as_expense_owner() now resolves caller via get_effective_user_id() (auth_id-first). Nicole and any other user with JWT email != public.users.email mismatch can create / edit their own reports again.';
END $$;
