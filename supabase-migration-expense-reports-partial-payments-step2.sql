-- ============================================================
-- Partial payments — STEP 2 of 2: table + trigger + backfill
--
-- Apply AFTER step 1 (the partially_paid enum value) has been
-- committed. Step 2 creates the expense_report_payments table,
-- the recompute + change-trigger functions, the settings row,
-- and backfills existing 'paid' reports as a single synthetic
-- payment each so the ledger is continuous.
--
-- Idempotent + safe to re-run.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. expense_report_payments table
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.expense_report_payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_report_id   UUID NOT NULL REFERENCES public.expense_reports(id) ON DELETE CASCADE,

  amount              NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  paid_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  payment_method      TEXT NOT NULL,
  reference_note      TEXT,

  paid_by             UUID REFERENCES public.users(id) ON DELETE SET NULL,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_expense_report_payments_report
  ON public.expense_report_payments (expense_report_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_expense_report_payments_paid_at
  ON public.expense_report_payments (paid_at DESC)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE public.expense_report_payments IS
  'Payment ledger for expense_reports. Each row is one disbursement (check, wire, ACH, Zelle, etc.). Sum of non-deleted payments drives the report.status flip from approved → partially_paid → paid via trg_expense_report_payments_recompute.';


-- ─────────────────────────────────────────────────────────────
-- 2. expense_reports.amount_paid_cached
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.expense_reports
  ADD COLUMN IF NOT EXISTS amount_paid_cached NUMERIC(12, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.expense_reports.amount_paid_cached IS
  'Cached sum of non-deleted expense_report_payments.amount for this report. Maintained by trg_expense_report_payments_recompute. Drives the "Paid $X of $Y" subtitle on partially-paid queue rows.';


-- ─────────────────────────────────────────────────────────────
-- 3. Recompute function
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recompute_expense_report_payment_state(p_report_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  total_paid    NUMERIC(12, 2);
  grand         NUMERIC(12, 2);
  current_status expense_report_status;
  last_paid_at  TIMESTAMPTZ;
  last_paid_by  UUID;
  last_note     TEXT;
BEGIN
  SELECT status, grand_total INTO current_status, grand
    FROM public.expense_reports WHERE id = p_report_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT COALESCE(SUM(amount), 0) INTO total_paid
    FROM public.expense_report_payments
   WHERE expense_report_id = p_report_id AND deleted_at IS NULL;

  SELECT paid_at, paid_by, reference_note
    INTO last_paid_at, last_paid_by, last_note
    FROM public.expense_report_payments
   WHERE expense_report_id = p_report_id AND deleted_at IS NULL
   ORDER BY paid_at DESC, created_at DESC
   LIMIT 1;

  IF current_status IN ('approved', 'partially_paid', 'paid') THEN
    IF total_paid <= 0 THEN
      UPDATE public.expense_reports
         SET status = 'approved',
             amount_paid_cached = 0,
             paid_at = NULL,
             paid_by = NULL,
             paid_note = NULL
       WHERE id = p_report_id;
    ELSIF grand IS NOT NULL AND total_paid >= grand THEN
      UPDATE public.expense_reports
         SET status = 'paid',
             amount_paid_cached = total_paid,
             paid_at  = last_paid_at,
             paid_by  = last_paid_by,
             paid_note = last_note
       WHERE id = p_report_id;
    ELSE
      UPDATE public.expense_reports
         SET status = 'partially_paid',
             amount_paid_cached = total_paid,
             paid_at  = last_paid_at,
             paid_by  = last_paid_by,
             paid_note = last_note
       WHERE id = p_report_id;
    END IF;
  ELSE
    UPDATE public.expense_reports
       SET amount_paid_cached = total_paid
     WHERE id = p_report_id;
  END IF;
END;
$$;


-- ─────────────────────────────────────────────────────────────
-- 4. Change trigger
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_expense_report_payment_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_expense_report_payment_state(OLD.expense_report_id);
    RETURN OLD;
  ELSE
    PERFORM public.recompute_expense_report_payment_state(NEW.expense_report_id);
    IF TG_OP = 'UPDATE' AND NEW.expense_report_id IS DISTINCT FROM OLD.expense_report_id THEN
      PERFORM public.recompute_expense_report_payment_state(OLD.expense_report_id);
    END IF;
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_expense_report_payments_recompute ON public.expense_report_payments;
CREATE TRIGGER trg_expense_report_payments_recompute
  AFTER INSERT OR UPDATE OR DELETE ON public.expense_report_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_expense_report_payment_change();


-- ─────────────────────────────────────────────────────────────
-- 5. updated_at trigger
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_expense_report_payments_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_expense_report_payments_updated_at ON public.expense_report_payments;
CREATE TRIGGER trg_expense_report_payments_updated_at
  BEFORE UPDATE ON public.expense_report_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_expense_report_payments_updated_at();


-- ─────────────────────────────────────────────────────────────
-- 6. RLS
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.expense_report_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS expense_report_payments_select ON public.expense_report_payments;
CREATE POLICY expense_report_payments_select ON public.expense_report_payments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.expense_reports er
      WHERE er.id = expense_report_payments.expense_report_id
    )
  );

DROP POLICY IF EXISTS expense_report_payments_write ON public.expense_report_payments;
CREATE POLICY expense_report_payments_write ON public.expense_report_payments
  FOR ALL TO authenticated
  USING (public.has_any_role('accounting', 'admin', 'superadmin'))
  WITH CHECK (public.has_any_role('accounting', 'admin', 'superadmin'));


-- ─────────────────────────────────────────────────────────────
-- 7. Settings row — payment method dropdown options
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.settings (key, value)
SELECT 'expense_payment_methods', '["check","zelle","wire","ach"]'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM public.settings WHERE key = 'expense_payment_methods'
);


-- ─────────────────────────────────────────────────────────────
-- 8. Backfill — replay legacy 'paid' reports as a single payment
-- ─────────────────────────────────────────────────────────────
-- Safe NOW because 'partially_paid' is committed (step 1 ran
-- in its own transaction). The trigger that fires per INSERT
-- can reference it without the 55P04 error.
INSERT INTO public.expense_report_payments (
  expense_report_id, amount, paid_at, payment_method, reference_note, paid_by
)
SELECT
  er.id,
  er.grand_total,
  COALESCE(er.paid_at, er.approved_at, er.submitted_at, er.created_at),
  'check',
  er.paid_note,
  er.paid_by
FROM public.expense_reports er
WHERE er.status = 'paid'
  AND er.grand_total IS NOT NULL
  AND er.grand_total > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.expense_report_payments p
    WHERE p.expense_report_id = er.id AND p.deleted_at IS NULL
  );


-- ─────────────────────────────────────────────────────────────
-- 9. Done
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  RAISE NOTICE 'Step 2 done — expense_report_payments table + trigger + backfill complete.';
END $$;
