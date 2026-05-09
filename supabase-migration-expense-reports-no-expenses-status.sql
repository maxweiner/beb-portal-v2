-- ── expense_report_status: add 'no_expenses' ──
--
-- Some past events don't need an expense report — buyer used a
-- company card, expensed via a different system, or just had no
-- reimbursable expenses. Auto-creating a draft for every event the
-- user worked is convenient but leaves these phantoms in the list.
--
-- 'no_expenses' is a soft-dismiss: the row stays in the DB so the
-- list of past events stays auditable, but it's hidden from the
-- default view. A new "Already expensed" filter chip surfaces them.
--
-- Lifecycle:
--   active → submitted_pending_review → approved → paid
--   active → no_expenses  (soft-dismiss; reversible to active)
--
-- Safe to re-run.
-- ============================================================

ALTER TYPE expense_report_status ADD VALUE IF NOT EXISTS 'no_expenses';

DO $$ BEGIN
  RAISE NOTICE 'expense_report_status now includes ''no_expenses''. Use the "Already expensed" button on a draft row to dismiss it.';
END $$;
