-- ============================================================
-- Expense reports — partial payments
--
-- Replaces the binary "approved → paid" transition with a real
-- payment ledger. Each payment is its own row in
-- expense_report_payments with amount, paid_at, payment_method,
-- reference_note (e.g. "Check #1234"), and paid_by.
--
-- The status flips along the way:
--   approved          (nothing paid yet)
--   partially_paid    (sum(payments) > 0 and < grand_total)
--   paid              (sum(payments) >= grand_total)
--
-- The flip is driven by an AFTER INSERT / UPDATE / DELETE trigger
-- on expense_report_payments so the app never has to keep status
-- and the ledger in sync manually.
--
-- A settings row holds the payment-method dropdown options. The
-- Add Payment modal's "+ Add New" appends a custom label to the
-- list so subsequent payments can pick it without operator
-- intervention.
--
-- Existing 'paid' reports are backfilled as a single payment
-- event (method='check', amount=grand_total, reference_note from
-- paid_note) so the ledger has continuity day-one.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. expense_report_status += 'partially_paid'
-- ─────────────────────────────────────────────────────────────
-- BEFORE 'paid' so the natural ordering is intuitive.
ALTER TYPE expense_report_status ADD VALUE IF NOT EXISTS 'partially_paid' BEFORE 'paid';


-- ─────────────────────────────────────────────────────────────
-- 2. expense_report_payments table
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.expense_report_payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_report_id   UUID NOT NULL REFERENCES public.expense_reports(id) ON DELETE CASCADE,

  -- Payment amount in dollars. CHECK > 0 so a zero payment can't
  -- accidentally flip status. Negative payments (refunds) would
  -- want a separate flow; not in scope here.
  amount              NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  paid_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 'check' / 'zelle' / 'wire' / 'ach' / a custom label the user
  -- typed via the modal's "+ Add New" option. Lowercased canonical
  -- form; UI title-cases for display.
  payment_method      TEXT NOT NULL,

  -- "Check #1234" / "Wire confirmation 5/14" / "Zelle to 330-555-0101".
  -- Free-text, capped to 500 chars by the API.
  reference_note      TEXT,

  -- Who recorded the payment. Distinct from paid_by on
  -- expense_reports (which is now derived from the most-recent
  -- payment's paid_by, maintained by the trigger).
  paid_by             UUID REFERENCES public.users(id) ON DELETE SET NULL,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Soft-delete so an accidental payment record can be undone
  -- without losing the audit trail.
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
-- 3. expense_reports.amount_paid_cached + helpers
-- ─────────────────────────────────────────────────────────────
-- Cached sum for fast queries (queue UI subtitle uses this).
-- The trigger keeps it in sync; never write to it directly.
ALTER TABLE public.expense_reports
  ADD COLUMN IF NOT EXISTS amount_paid_cached NUMERIC(12, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.expense_reports.amount_paid_cached IS
  'Cached sum of non-deleted expense_report_payments.amount for this report. Maintained by trg_expense_report_payments_recompute. Drives the "Paid $X of $Y" subtitle on partially-paid queue rows.';


-- ─────────────────────────────────────────────────────────────
-- 4. Recompute function — status + amount_paid_cached
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

  -- Pull the most-recent payment's metadata so we can keep the
  -- legacy paid_at / paid_by / paid_note in lockstep — the rest
  -- of the app + the QB export still reads from those columns.
  SELECT paid_at, paid_by, reference_note
    INTO last_paid_at, last_paid_by, last_note
    FROM public.expense_report_payments
   WHERE expense_report_id = p_report_id AND deleted_at IS NULL
   ORDER BY paid_at DESC, created_at DESC
   LIMIT 1;

  -- Decide the new status. Never override a non-payment state
  -- (active / submitted_pending_review / no_expenses) — those
  -- live before the payment phase and a stray payment shouldn't
  -- jump the queue.
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
    -- Not in a payment-eligible status. Still keep
    -- amount_paid_cached accurate for read-only display.
    UPDATE public.expense_reports
       SET amount_paid_cached = total_paid
     WHERE id = p_report_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.recompute_expense_report_payment_state(UUID) IS
  'Sums non-deleted payments for the report, flips status (approved / partially_paid / paid), and mirrors the latest payment metadata onto the legacy paid_at / paid_by / paid_note columns. Called by trg_expense_report_payments_recompute on every payment row change.';


-- ─────────────────────────────────────────────────────────────
-- 5. Trigger — recompute after any payment row change
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
    -- Cover the rare edge where a payment row was MOVED to a
    -- different report (very rare; defensive).
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
-- 6. updated_at trigger on the payments table
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
-- 7. RLS — mirrors expense_reports access
-- ─────────────────────────────────────────────────────────────
-- Read: anyone who can read the parent expense_report can read its
-- payments. Write: accounting / admin / superadmin / partner.
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
-- 8. Settings row — payment method dropdown options
-- ─────────────────────────────────────────────────────────────
-- Default list. The Add Payment modal's "+ Add New" appends a
-- lowercased custom label so future payments can pick from it
-- without admin help.
INSERT INTO public.settings (key, value)
SELECT 'expense_payment_methods', '["check","zelle","wire","ach"]'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM public.settings WHERE key = 'expense_payment_methods'
);


-- ─────────────────────────────────────────────────────────────
-- 9. Backfill — replay legacy 'paid' reports as a single payment
-- ─────────────────────────────────────────────────────────────
-- For every currently-paid report that has no payment row yet,
-- insert one synthetic payment so the ledger is continuous.
-- Method defaults to 'check' (most common before this feature
-- existed); operator can edit if it was actually Zelle / wire.
-- amount = grand_total so amount_paid_cached recomputes correctly
-- via the trigger.
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
-- 10. Done
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  RAISE NOTICE 'Partial payments: expense_report_payments table + trigger + settings + backfill complete.';
END $$;
