-- ── Expense reports: stop auto-populating $7,500 for partners ──
-- Original behavior (PR9): BEFORE INSERT trigger set comp_rate to
-- 7500 when users.is_partner was true. Per partner request, that
-- default is being removed — partners now enter their own comp
-- amount per trip just like the rest of the editable comp_rate
-- experience.
--
-- Effect:
--   • is_partner=true → comp_rate stays at 0 unless the partner
--     edits it on the report (or supplies it at insert time).
--   • non-partner buyers: unchanged — still seeded from
--     buyer_rates.default_event_rate.
--
-- Existing reports are NOT touched — only future inserts behave
-- differently. If a partner has open reports already showing
-- $7,500 they want to wipe out, they can edit comp_rate to 0
-- on those reports manually. Mass-zeroing existing reports would
-- silently change historical totals on already-paid trips, so
-- that's intentionally left as a manual step.
--
-- Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION set_default_comp_rate() RETURNS TRIGGER AS $$
DECLARE
  v_default NUMERIC(10,2);
BEGIN
  -- Caller already chose a rate (e.g. an admin importing data); leave it alone.
  IF NEW.comp_rate IS NOT NULL AND NEW.comp_rate > 0 THEN RETURN NEW; END IF;

  -- Partners enter their own comp now. Buyers still seed from
  -- buyer_rates.default_event_rate; falls back to 0 when nothing
  -- is configured.
  SELECT default_event_rate INTO v_default
    FROM buyer_rates WHERE user_id = NEW.user_id;
  NEW.comp_rate := COALESCE(v_default, 0);

  -- Initialise the denormalised totals so a freshly-created report
  -- already shows the right grand_total without waiting for a recompute.
  NEW.total_compensation := NEW.comp_rate;
  NEW.grand_total := COALESCE(NEW.total_expenses, 0) + NEW.comp_rate;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON COLUMN expense_reports.comp_rate IS
  'Per-trip compensation amount. Defaults from buyer_rates.default_event_rate at insert; partners get 0 (they enter their own per trip). Editable while status = active.';

DO $$ BEGIN
  RAISE NOTICE 'Partner $7,500 auto-default removed; partners now enter comp_rate manually.';
END $$;
