-- ============================================================
-- Expense Delegates — submitted_by_user_id column on expense_reports
--
-- Captures WHO submitted a report, distinct from WHO OWNS it.
-- For self-submissions (the common case): NULL.
-- For delegated submissions (Ryan submitting for Alan): the
-- delegate's user id.
--
-- Drives two downstream behaviors:
--   1. The PDF renders an audit line near the header when the
--      column is non-null: "Submitted by Ryan Smith on behalf of
--      Alan Jones · May 13, 2026 at 3:42 PM"
--   2. The /api/expense-reports/[id]/submit endpoint reads the
--      column to decide whether to fire the
--      delegate-submission notification (email + SMS to the
--      principal). Self-submissions don't fire it.
--
-- Why a column (not derived from expense_delegates):
--   - Captures the audit snapshot at submit-time. If the
--     delegation is later revoked, the report still attributes
--     correctly. Querying expense_delegates retroactively would
--     show "no active delegation" even though the submission was
--     legitimate at the time.
--   - Avoids a JOIN on every PDF render.
--
-- Idempotent. Safe to re-run.
-- ============================================================

ALTER TABLE public.expense_reports
  ADD COLUMN IF NOT EXISTS submitted_by_user_id uuid
    REFERENCES public.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.expense_reports.submitted_by_user_id IS
  'Who submitted this report. NULL when the owner submitted their own; set to the delegate''s user id when an active expense_delegate filed on behalf of the owner. Snapshot at submit-time — survives revocation of the delegation.';

-- Indexed only when non-null since the common-case lookup is "show
-- me the reports a given delegate has submitted" (for the audit
-- log in PR 5). Self-submissions don't need to be indexed by
-- submitted_by since that's already trivially equal to user_id.
CREATE INDEX IF NOT EXISTS idx_expense_reports_submitted_by
  ON public.expense_reports (submitted_by_user_id)
  WHERE submitted_by_user_id IS NOT NULL;

DO $$ BEGIN
  RAISE NOTICE 'expense_reports.submitted_by_user_id added. /api/expense-reports/[id]/submit will stamp it when the caller != report owner (delegate path). PDF audit line in lib/expenses/pdf.tsx surfaces it when present.';
END $$;
