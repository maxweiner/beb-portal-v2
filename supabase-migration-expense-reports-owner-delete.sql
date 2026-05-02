-- ============================================================
-- Expense Reports — allow owner-delete of their own drafts
--
-- Previous policy let only admin/superadmin delete reports.
-- Now that the expenses page auto-creates a report for every
-- event the buyer worked, buyers need to be able to clear out
-- ones they don't actually intend to submit (e.g., older events
-- they never expensed against, or stale auto-generated rows).
--
-- Safety: only "active" (Non-Submitted) reports are deletable
-- by the owner. Submitted / approved / paid reports stay
-- admin-only because they have downstream side effects
-- (accountant emails, payout tracking) we don't want to lose.
--
-- Safe to re-run.
-- ============================================================

DROP POLICY IF EXISTS expense_reports_delete ON expense_reports;
CREATE POLICY expense_reports_delete ON expense_reports FOR DELETE TO public
  USING (
    public.get_my_role() IN ('admin','superadmin')
    OR (
      expense_reports.user_id = public.get_effective_user_id()
      AND expense_reports.status = 'active'
    )
  );

DO $$ BEGIN
  RAISE NOTICE 'expense_reports_delete now allows owner-delete of own active reports.';
END $$;
