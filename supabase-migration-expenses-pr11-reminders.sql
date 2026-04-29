-- ============================================================
-- Expenses & Invoicing PR 11: submit-reminder tracking columns.
--
-- Cron worker /api/cron/expense-submit-reminders nags any 'active'
-- expense report whose event started 7+ days ago, then again every 3
-- days, max 3 times. These two columns track that state so the cron
-- doesn't double-nag and stops once the buyer's been pinged 3 times.
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE expense_reports
  ADD COLUMN IF NOT EXISTS last_reminder_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_count        INT NOT NULL DEFAULT 0
    CHECK (reminder_count >= 0);

CREATE INDEX IF NOT EXISTS idx_expense_reports_reminder_due
  ON expense_reports (last_reminder_sent_at NULLS FIRST)
  WHERE status = 'active' AND reminder_count < 3;

DO $$ BEGIN
  RAISE NOTICE 'Submit-reminder tracking columns installed.';
END $$;
