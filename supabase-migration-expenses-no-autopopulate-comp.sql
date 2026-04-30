-- ============================================================
-- Expenses: stop auto-populating comp_rate on new reports.
--
-- The PR9 migration installed a BEFORE INSERT trigger that defaulted
-- comp_rate to $7,500 for partners or buyer_rates.default_event_rate
-- for buyers. Per request, all users should now enter the amount
-- manually each time. Reports that already exist keep whatever
-- comp_rate they have — only future inserts change.
--
-- Safe to re-run.
-- ============================================================

DROP TRIGGER IF EXISTS trg_set_default_comp_rate ON expense_reports;
DROP FUNCTION IF EXISTS set_default_comp_rate();

COMMENT ON COLUMN expense_reports.comp_rate IS
  'Per-trip compensation amount. User enters this manually each report; column default is 0.';

DO $$ BEGIN
  RAISE NOTICE 'Auto-populate trigger dropped. New expense_reports rows will start with comp_rate = 0.';
END $$;
