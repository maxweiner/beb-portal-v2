-- ============================================================
-- Expenses & Invoicing PR 13: quiet-hours queue for accountant emails.
--
-- When a partner approves a report between 9pm-7am Eastern or on
-- a weekend, we no longer fire the accountant email immediately —
-- we stamp the next business-hours moment in
-- accountant_email_send_after and a cron flushes it once that time
-- has passed.
--
-- accountant_email_sent_at remains the canonical "we delivered it"
-- marker (same column the immediate-send path stamps). The new
-- column only matters BEFORE the send.
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE expense_reports
  ADD COLUMN IF NOT EXISTS accountant_email_send_after TIMESTAMPTZ;

COMMENT ON COLUMN expense_reports.accountant_email_send_after IS 'Quiet-hours queue: NULL = send immediately when approved; non-null = scheduled send time, flushed by /api/cron/expense-quiet-hours-flush.';

-- Partial index so the cron's claim query is fast.
CREATE INDEX IF NOT EXISTS idx_expense_reports_email_due
  ON expense_reports (accountant_email_send_after)
  WHERE status = 'approved'
    AND accountant_email_sent_at IS NULL
    AND accountant_email_send_after IS NOT NULL;

DO $$ BEGIN
  RAISE NOTICE 'Quiet-hours queue column installed.';
END $$;
