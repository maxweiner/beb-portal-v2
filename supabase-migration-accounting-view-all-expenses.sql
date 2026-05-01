-- ============================================================
-- Grant the `accounting` role view-all access to expense reports.
--
-- Background: the original PR1 RLS only included 'admin' and 'superadmin'
-- in the role-based bypass on expense_reports / expenses. The accounting
-- role (added later) was left out, so accounting users could only see
-- reports they owned — useless for an accounts-payable workflow.
--
-- This migration replaces the SELECT policies on both tables to include
-- 'accounting'. INSERT / UPDATE / DELETE remain admin/superadmin-only —
-- accounting gets read-only.
--
-- Safe to re-run.
-- ============================================================

DROP POLICY IF EXISTS expense_reports_select ON expense_reports;
CREATE POLICY expense_reports_select ON expense_reports FOR SELECT TO public
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.email = auth.jwt()->>'email'
        AND (u.id = expense_reports.user_id OR u.role IN ('admin','superadmin','accounting'))
    )
  );

DROP POLICY IF EXISTS expenses_select ON expenses;
CREATE POLICY expenses_select ON expenses FOR SELECT TO public
  USING (
    EXISTS (
      SELECT 1
      FROM expense_reports r
      JOIN users u ON u.email = auth.jwt()->>'email'
      WHERE r.id = expenses.expense_report_id
        AND (u.id = r.user_id OR u.role IN ('admin','superadmin','accounting'))
    )
  );

DO $$ BEGIN
  RAISE NOTICE 'accounting role granted view-all access to expense_reports + expenses.';
END $$;
