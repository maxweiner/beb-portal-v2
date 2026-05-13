-- ============================================================
-- Expense Delegates — RLS extension for expense_reports + expenses
--
-- After this migration, an active delegate (per expense_delegates,
-- WHERE revoked_at IS NULL) has read+write access to the principal's
-- expense reports and line items, matching what the principal could
-- do themselves. Admins keep their separate "always permitted" path.
-- Owners (including delegates) can still only mutate while
-- status = 'active', same as before.
--
-- This unblocks Ryan submitting expense reports on Alan's behalf:
-- after he picks "Submitting for: Alan" in the Expenses module
-- picker (PR 3 frontend), every direct-Supabase-client read and
-- write Ryan issues with user_id = Alan's id passes RLS.
--
-- New helper:
--   can_act_as_expense_owner(target_user_id uuid)
--   - true if the caller is the target user themselves
--   - OR an active delegate of the target user
--   - admin/superadmin handled separately at the policy level so
--     the helper stays a clean "can act AS this person?" predicate
--
-- Replaces the 7 existing inline `auth.jwt()->>'email'` policies
-- on expense_reports + expenses with helper-driven equivalents.
-- This is a localized application of the auth_id-first migration
-- direction from PR #582, scoped to just the Expenses module so
-- the delegate change stays focused.
--
-- Out of scope for this migration (kept narrow on purpose):
--   - compensation_invoices / compensation_line_items / buyer_rates
--     still use the legacy inline-email policies. Patch in a
--     follow-up if delegate read/write surfaces issues there.
--   - Storage bucket policies (none today — all uploads go through
--     service-role API routes, which gain their own delegate check).
--
-- Depends on:
--   supabase-migration-expense-delegates.sql  (creates the
--     expense_delegates table referenced below)
--   has_any_role() function (added in earlier PR; used by W-9 RLS too)
--
-- Idempotent. Safe to re-run.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. Helper: can_act_as_expense_owner(target_user_id uuid)
-- ─────────────────────────────────────────────────────────────
--
-- Returns true if the calling JWT belongs to a user who either:
--   (a) IS the target user, or
--   (b) has an active (revoked_at IS NULL) delegation to operate
--       on the target user's expense data.
--
-- Email lookup matches the existing RLS pattern on expense_reports
-- so this change doesn't have to also bring the rest of the table
-- onto get_effective_user_id() in a single sweep — that's a
-- separate cleanup we can do later if/when impersonation gets
-- extended into the Expenses module (currently it isn't).

CREATE OR REPLACE FUNCTION public.can_act_as_expense_owner(target_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.email = auth.jwt() ->> 'email'
      AND (
        u.id = target_user_id
        OR EXISTS (
          SELECT 1
          FROM public.expense_delegates ed
          WHERE ed.delegate_user_id  = u.id
            AND ed.principal_user_id = target_user_id
            AND ed.revoked_at IS NULL
        )
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_act_as_expense_owner(uuid) TO authenticated, anon;


-- ─────────────────────────────────────────────────────────────
-- 2. expense_reports — replace SELECT / INSERT / UPDATE
-- ─────────────────────────────────────────────────────────────

-- SELECT: admins see everything; owners + delegates see their own.
DROP POLICY IF EXISTS expense_reports_select ON public.expense_reports;
CREATE POLICY expense_reports_select ON public.expense_reports
  FOR SELECT TO public
  USING (
    public.has_any_role('admin', 'superadmin')
    OR public.can_act_as_expense_owner(user_id)
  );

-- INSERT: admins can create for anyone; owners + delegates can
-- create rows owned by the target user (`user_id` on the new row
-- must be a user the caller can act for).
DROP POLICY IF EXISTS expense_reports_insert ON public.expense_reports;
CREATE POLICY expense_reports_insert ON public.expense_reports
  FOR INSERT TO public
  WITH CHECK (
    public.has_any_role('admin', 'superadmin')
    OR public.can_act_as_expense_owner(user_id)
  );

-- UPDATE: admins can update at any status; owners + delegates can
-- only update while the report is still in draft ('active').
-- Status check is preserved exactly as the prior policy enforced.
DROP POLICY IF EXISTS expense_reports_update ON public.expense_reports;
CREATE POLICY expense_reports_update ON public.expense_reports
  FOR UPDATE TO public
  USING (
    public.has_any_role('admin', 'superadmin')
    OR (
      public.can_act_as_expense_owner(user_id)
      AND status = 'active'
    )
  )
  WITH CHECK (
    public.has_any_role('admin', 'superadmin')
    OR public.can_act_as_expense_owner(user_id)
  );


-- ─────────────────────────────────────────────────────────────
-- 3. expenses (line items) — replace SELECT / INSERT / UPDATE / DELETE
-- ─────────────────────────────────────────────────────────────
--
-- Line items inherit access from their parent report. Same
-- two-tier rule: admins always, owners + delegates only while the
-- parent report is in 'active' status (write side).

DROP POLICY IF EXISTS expenses_select ON public.expenses;
CREATE POLICY expenses_select ON public.expenses
  FOR SELECT TO public
  USING (
    EXISTS (
      SELECT 1
      FROM public.expense_reports r
      WHERE r.id = expenses.expense_report_id
        AND (
          public.has_any_role('admin', 'superadmin')
          OR public.can_act_as_expense_owner(r.user_id)
        )
    )
  );

DROP POLICY IF EXISTS expenses_insert ON public.expenses;
CREATE POLICY expenses_insert ON public.expenses
  FOR INSERT TO public
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.expense_reports r
      WHERE r.id = expenses.expense_report_id
        AND (
          public.has_any_role('admin', 'superadmin')
          OR (
            public.can_act_as_expense_owner(r.user_id)
            AND r.status = 'active'
          )
        )
    )
  );

DROP POLICY IF EXISTS expenses_update ON public.expenses;
CREATE POLICY expenses_update ON public.expenses
  FOR UPDATE TO public
  USING (
    EXISTS (
      SELECT 1
      FROM public.expense_reports r
      WHERE r.id = expenses.expense_report_id
        AND (
          public.has_any_role('admin', 'superadmin')
          OR (
            public.can_act_as_expense_owner(r.user_id)
            AND r.status = 'active'
          )
        )
    )
  );

DROP POLICY IF EXISTS expenses_delete ON public.expenses;
CREATE POLICY expenses_delete ON public.expenses
  FOR DELETE TO public
  USING (
    EXISTS (
      SELECT 1
      FROM public.expense_reports r
      WHERE r.id = expenses.expense_report_id
        AND (
          public.has_any_role('admin', 'superadmin')
          OR (
            public.can_act_as_expense_owner(r.user_id)
            AND r.status = 'active'
          )
        )
    )
  );


-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  RAISE NOTICE 'Expense Delegates RLS extension applied. Active delegates can now read/write the principal''s expense_reports + expenses via the supabase client. API routes still need their own delegate check (PR 3 code change) — RLS guards the data layer, the API helper guards routes that bypass RLS via service-role.';
END $$;
