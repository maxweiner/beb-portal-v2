-- ============================================================
-- Expenses & Invoicing PR 9: per-trip compensation (Option A).
--
-- Adds a single comp_rate column to expense_reports — the buyer /
-- partner's pay for that event. Spec calls it "Option A: compensation
-- auto-attached to trip" — one number per (event, user) report,
-- editable until submission, summed into grand_total alongside the
-- expense line items.
--
-- Default value:
--   - is_partner=true → $7,500 (partner flat rate)
--   - else → buyer_rates.default_event_rate (or 0 if not set)
-- Set automatically via BEFORE INSERT trigger.
--
-- Option C (multi-trip period invoice) reuses the existing
-- compensation_invoices / compensation_line_items tables from PR1
-- and is deferred to a follow-up PR.
--
-- Safe to re-run.
-- ============================================================

-- ── 1. comp_rate column ───────────────────────────────────
ALTER TABLE expense_reports
  ADD COLUMN IF NOT EXISTS comp_rate NUMERIC(10,2) NOT NULL DEFAULT 0
    CHECK (comp_rate >= 0);

COMMENT ON COLUMN expense_reports.comp_rate IS 'Per-trip compensation amount (Option A flow). Defaults from is_partner / buyer_rates on insert; editable while status = active.';

-- ── 2. recompute helper now reads comp_rate ──────────────
-- Replaces the PR5 version. comp_rate is the source of truth for
-- total_compensation; grand_total = expenses + comp_rate.
CREATE OR REPLACE FUNCTION recompute_expense_report_totals(p_report_id UUID)
RETURNS VOID AS $$
DECLARE
  v_total NUMERIC(12,2);
  v_comp  NUMERIC(12,2);
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO v_total FROM expenses WHERE expense_report_id = p_report_id;
  SELECT comp_rate INTO v_comp FROM expense_reports WHERE id = p_report_id;
  UPDATE expense_reports
    SET total_expenses = v_total,
        total_compensation = COALESCE(v_comp, 0),
        grand_total    = v_total + COALESCE(v_comp, 0)
    WHERE id = p_report_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 3. BEFORE INSERT trigger sets the default rate ───────
CREATE OR REPLACE FUNCTION set_default_comp_rate() RETURNS TRIGGER AS $$
DECLARE
  v_is_partner BOOLEAN;
  v_default NUMERIC(10,2);
BEGIN
  -- Caller already chose a rate (e.g. an admin importing data); leave it alone.
  IF NEW.comp_rate IS NOT NULL AND NEW.comp_rate > 0 THEN RETURN NEW; END IF;

  SELECT is_partner INTO v_is_partner FROM users WHERE id = NEW.user_id;
  IF v_is_partner IS TRUE THEN
    NEW.comp_rate := 7500;
  ELSE
    SELECT default_event_rate INTO v_default FROM buyer_rates WHERE user_id = NEW.user_id;
    NEW.comp_rate := COALESCE(v_default, 0);
  END IF;

  -- Initialise the denormalised totals so a freshly-created report
  -- already shows the right grand_total without waiting for a recompute.
  NEW.total_compensation := NEW.comp_rate;
  NEW.grand_total := COALESCE(NEW.total_expenses, 0) + NEW.comp_rate;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_set_default_comp_rate ON expense_reports;
CREATE TRIGGER trg_set_default_comp_rate
BEFORE INSERT ON expense_reports
FOR EACH ROW EXECUTE FUNCTION set_default_comp_rate();

-- ── 4. AFTER UPDATE trigger recomputes when comp_rate changes ──
CREATE OR REPLACE FUNCTION touch_totals_on_comp_change() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.comp_rate IS DISTINCT FROM NEW.comp_rate THEN
    PERFORM recompute_expense_report_totals(NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_totals_on_comp_change ON expense_reports;
CREATE TRIGGER trg_touch_totals_on_comp_change
AFTER UPDATE OF comp_rate ON expense_reports
FOR EACH ROW EXECUTE FUNCTION touch_totals_on_comp_change();

-- ── 5. Backfill existing reports ─────────────────────────
-- Reports created before this migration have comp_rate = 0 (the new
-- column's default). Set each to the user's role-appropriate default.
UPDATE expense_reports r
   SET comp_rate = 7500
  FROM users u
 WHERE u.id = r.user_id
   AND u.is_partner IS TRUE
   AND r.comp_rate = 0;

UPDATE expense_reports r
   SET comp_rate = br.default_event_rate
  FROM users u
  JOIN buyer_rates br ON br.user_id = u.id
 WHERE u.id = r.user_id
   AND u.is_partner IS NOT TRUE
   AND br.default_event_rate IS NOT NULL
   AND br.default_event_rate > 0
   AND r.comp_rate = 0;

-- Sync denormalised totals on every report (cheap with the volumes
-- expected here; idempotent).
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM expense_reports LOOP
    PERFORM recompute_expense_report_totals(r.id);
  END LOOP;
END $$;

-- ── 6. Verify ────────────────────────────────────────────
DO $$
DECLARE n_with_comp INT;
BEGIN
  SELECT COUNT(*) INTO n_with_comp FROM expense_reports WHERE comp_rate > 0;
  RAISE NOTICE 'Compensation column installed. Reports with non-zero comp: %', n_with_comp;
END $$;
