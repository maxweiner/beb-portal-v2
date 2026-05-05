-- ── Expenses: "Paid by Credit Card" flag ──────────────────────
-- When set, the line item stays visible on the report (still
-- counts toward event-level cost reporting) but is EXCLUDED from
-- the buyer's reimbursable total — these are charges the
-- accountant already paid via the company credit card.
--
-- Updates the recompute_expense_report_totals helper to honor
-- the flag. Existing rows default to FALSE (i.e., reimbursable).
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS paid_by_credit_card BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.expenses.paid_by_credit_card IS
  'Marks a line item as paid via the company credit card by the accountant. The row stays visible on the report but is NOT included in total_expenses (reimbursable amount).';

-- Replace the totals helper to exclude credit-card lines.
CREATE OR REPLACE FUNCTION recompute_expense_report_totals(p_report_id UUID)
RETURNS VOID AS $$
DECLARE
  v_total NUMERIC(12,2);
  v_comp  NUMERIC(12,2);
  v_bonus NUMERIC(12,2);
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO v_total
    FROM expenses
   WHERE expense_report_id = p_report_id
     AND paid_by_credit_card = FALSE;
  SELECT comp_rate, bonus_amount INTO v_comp, v_bonus
    FROM expense_reports WHERE id = p_report_id;
  UPDATE expense_reports
     SET total_expenses     = v_total,
         total_compensation = COALESCE(v_comp, 0),
         grand_total        = v_total + COALESCE(v_comp, 0) + COALESCE(v_bonus, 0)
   WHERE id = p_report_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- The existing AFTER INSERT/UPDATE/DELETE trigger on expenses
-- (trg_touch_expense_report_totals) already calls this function
-- per-row, so toggling the flag will recompute via the existing
-- AMOUNT-watching trigger. To make the flag itself trigger a
-- recompute even when amount didn't change, add the column to
-- the trigger's UPDATE OF list.

DROP TRIGGER IF EXISTS trg_touch_expense_report_totals ON expenses;
CREATE TRIGGER trg_touch_expense_report_totals
AFTER INSERT OR UPDATE OF amount, expense_report_id, paid_by_credit_card OR DELETE ON expenses
FOR EACH ROW EXECUTE FUNCTION touch_expense_report_totals();

DO $$ BEGIN
  RAISE NOTICE 'expenses.paid_by_credit_card installed; recompute helper now excludes flagged rows from total_expenses.';
END $$;
