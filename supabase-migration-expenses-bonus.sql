-- ============================================================
-- Expenses: per-report bonus pay (partner-only).
--
-- Single bonus per expense report. Granted by a partner (not the
-- buyer themselves, not regular admins). Adds to grand_total alongside
-- expenses + compensation. Includes a short free-form note so the
-- partner can record context ("Q4 incentive", "extra for the long
-- drive home", etc.).
--
-- RLS: the existing UPDATE policy on expense_reports already lets
-- admins write any column. The "partner-only" gate for the bonus
-- columns is enforced server-side by the dedicated route — clients
-- shouldn't write bonus_amount / bonus_note via direct supabase
-- updates.
--
-- Safe to re-run.
-- ============================================================

-- ── 1. Columns ───────────────────────────────────────────────
ALTER TABLE expense_reports
  ADD COLUMN IF NOT EXISTS bonus_amount NUMERIC(10,2) NOT NULL DEFAULT 0
    CHECK (bonus_amount >= 0);

ALTER TABLE expense_reports
  ADD COLUMN IF NOT EXISTS bonus_note TEXT NULL;

COMMENT ON COLUMN expense_reports.bonus_amount IS
  'Partner-granted bonus pay for this report. Added to grand_total. Buyer cannot edit.';
COMMENT ON COLUMN expense_reports.bonus_note IS
  'Optional short note from the partner describing the bonus.';

-- ── 2. Replace recompute helper to include bonus ─────────────
CREATE OR REPLACE FUNCTION recompute_expense_report_totals(p_report_id UUID)
RETURNS VOID AS $$
DECLARE
  v_total NUMERIC(12,2);
  v_comp  NUMERIC(12,2);
  v_bonus NUMERIC(12,2);
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO v_total
    FROM expenses WHERE expense_report_id = p_report_id;
  SELECT comp_rate, bonus_amount INTO v_comp, v_bonus
    FROM expense_reports WHERE id = p_report_id;
  UPDATE expense_reports
     SET total_expenses     = v_total,
         total_compensation = COALESCE(v_comp, 0),
         grand_total        = v_total + COALESCE(v_comp, 0) + COALESCE(v_bonus, 0)
   WHERE id = p_report_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 3. Trigger: recompute when bonus changes ─────────────────
CREATE OR REPLACE FUNCTION touch_totals_on_bonus_change() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.bonus_amount IS DISTINCT FROM NEW.bonus_amount THEN
    PERFORM recompute_expense_report_totals(NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_totals_on_bonus_change ON expense_reports;
CREATE TRIGGER trg_touch_totals_on_bonus_change
AFTER UPDATE OF bonus_amount ON expense_reports
FOR EACH ROW EXECUTE FUNCTION touch_totals_on_bonus_change();

-- ── 4. Backfill grand_total to include bonus_amount = 0 ──────
-- (No-op for the new column default of 0, but ensures any existing
--  reports that were already updated by the recompute helper stay
--  in sync if the column was somehow non-zero already.)
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM expense_reports LOOP
    PERFORM recompute_expense_report_totals(r.id);
  END LOOP;
END $$;

DO $$ BEGIN
  RAISE NOTICE 'expense_reports bonus_amount + bonus_note installed.';
END $$;
