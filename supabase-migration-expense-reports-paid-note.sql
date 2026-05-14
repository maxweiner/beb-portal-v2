-- ============================================================
-- Add expense_reports.paid_note
--
-- Free-text note captured at mark-paid time so the accountant can
-- annotate HOW the report was paid (e.g. "Check #1234", "Wire
-- 5/14", "Zelle to 330-555-0101", "Bank xfer ACH"). Surfaced in
-- the Accounting Hub detail panel for paid reports.
--
-- Cleared on unmark-paid so a re-mark gets a fresh note (matches
-- the symmetric reset on paid_at / paid_by that the unmark route
-- already does).
-- ============================================================

ALTER TABLE public.expense_reports
  ADD COLUMN IF NOT EXISTS paid_note TEXT NULL;

COMMENT ON COLUMN public.expense_reports.paid_note IS
  'Free-text note captured when the accountant marks a report as paid — typically how the payment was disbursed (Check #1234, Wire date, Zelle, etc.). Cleared on unmark-paid.';

DO $$ BEGIN
  RAISE NOTICE 'expense_reports.paid_note added.';
END $$;
