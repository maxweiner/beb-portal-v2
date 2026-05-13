-- ============================================================
-- Reconciliation: 'voided_cashed' alarm for voided checks that
-- somehow showed up in the bank's cleared list.
--
-- Background
-- ----------
-- The check register on Day Entry now has a "Voided Check" option
-- in the payment-type dropdown (in addition to "check" / "cash").
-- A check marked voided in our system should NEVER appear in
-- cleared_checks (the bank-statement import). When one does, it's
-- either fraud, a bank error, or a genuinely-cashed check that got
-- mis-flagged in our register — all of which warrant an alarm.
--
-- Migration steps
-- ---------------
-- 1. Add 'voided_cashed' to the reconciliation_finding_type enum.
-- 2. Replace the reconciliation_run_match() function (v4):
--    - Carry payment_type from buyer_checks through the CTEs
--    - Aggregate "any voided row for this check#" → is_voided
--    - Add a new top-priority branch in the classification CASE:
--      `is_voided AND cleared_count > 0` → 'voided_cashed'
--      (takes precedence over duplicate_clearing — a voided check
--      cashing once is already the alarm; cashing multiple times
--      compounds the alarm but the classification stays voided_cashed)
--    - All other branches unchanged from v3
--
-- Idempotent. Safe to re-run.
-- ============================================================

ALTER TYPE reconciliation_finding_type ADD VALUE IF NOT EXISTS 'voided_cashed';


CREATE OR REPLACE FUNCTION public.reconciliation_run_match(p_brand TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_at TIMESTAMPTZ := now();
  v_counts JSONB;
BEGIN
  WITH
    written_checks AS (
      -- Per-row buyer_checks. Each row carries its own payment_type
      -- so we can detect "voided" status downstream.
      SELECT
        bc.check_number,
        bc.amount AS written_amount,
        bc.payment_type,
        e.id      AS event_id,
        e.store_name AS event_store_name,
        e.start_date AS event_start_date,
        (e.start_date + ((COALESCE(bc.day_number, 1) - 1) * INTERVAL '1 day'))::date AS written_date,
        CASE WHEN bc.entry_id IS NULL THEN 'Store commission' ELSE 'Seller' END AS payee_kind
      FROM public.buyer_checks bc
      JOIN public.events e ON e.id = bc.event_id
      WHERE e.brand = p_brand
        AND bc.check_number IS NOT NULL
        AND bc.check_number <> ''

      UNION ALL

      -- Store-commission checks stored on event_days. These don't
      -- carry a payment_type column today; treat as non-voided.
      SELECT
        ed.store_commission_check_number AS check_number,
        ed.store_commission_check_amount AS written_amount,
        'check'::TEXT AS payment_type,
        e.id      AS event_id,
        e.store_name AS event_store_name,
        e.start_date AS event_start_date,
        (e.start_date + ((ed.day_number - 1) * INTERVAL '1 day'))::date AS written_date,
        'Store commission' AS payee_kind
      FROM public.event_days ed
      JOIN public.events e ON e.id = ed.event_id
      WHERE e.brand = p_brand
        AND ed.store_commission_check_number IS NOT NULL
        AND ed.store_commission_check_number <> ''
        AND COALESCE(ed.store_commission_check_amount, 0) > 0
    ),
    written_grouped AS (
      SELECT
        check_number,
        -- For amount, exclude voided rows from the sum so amount_delta
        -- compares only the SUPPOSED-TO-BE-PAID amount against cleared.
        -- (If ALL rows for a check# are voided, sum is 0; the alarm
        -- branch fires when cleared_count > 0 regardless.)
        SUM(CASE WHEN payment_type = 'voided' THEN 0 ELSE written_amount END) AS written_amount,
        -- is_voided flag: any voided row → true.
        bool_or(payment_type = 'voided') AS is_voided,
        (array_agg(event_id          ORDER BY event_start_date DESC NULLS LAST))[1] AS event_id,
        (array_agg(event_store_name  ORDER BY event_start_date DESC NULLS LAST))[1] AS event_store_name,
        MAX(event_start_date)::date  AS event_start_date,
        MAX(written_date)::date      AS written_date,
        (array_agg(payee_kind        ORDER BY event_start_date DESC NULLS LAST))[1] AS payee_kind
      FROM written_checks
      GROUP BY check_number
    ),
    cleared_grouped AS (
      SELECT
        check_number,
        SUM(cleared_amount) AS cleared_amount_total,
        COUNT(*)::int       AS cleared_count,
        array_agg(cleared_date ORDER BY cleared_date) AS cleared_dates
      FROM public.cleared_checks
      WHERE brand = p_brand
      GROUP BY check_number
    ),
    allowlist AS (
      SELECT check_number
      FROM public.non_event_check_numbers
      WHERE brand = p_brand
    ),
    joined AS (
      SELECT
        COALESCE(w.check_number, c.check_number) AS check_number,
        w.written_amount,
        COALESCE(w.is_voided, false) AS is_voided,
        c.cleared_amount_total,
        COALESCE(c.cleared_count, 0) AS cleared_count,
        (COALESCE(w.written_amount, 0) - COALESCE(c.cleared_amount_total, 0)) AS amount_delta,
        w.written_date,
        c.cleared_dates,
        w.event_id,
        CASE
          WHEN w.event_id IS NOT NULL THEN
            w.event_store_name || ' · ' || to_char(w.event_start_date, 'Mon DD, YYYY')
          ELSE NULL
        END AS event_label,
        w.payee_kind AS payee_label,
        EXISTS (SELECT 1 FROM allowlist a WHERE a.check_number = COALESCE(w.check_number, c.check_number)) AS allowlisted
      FROM written_grouped w
      FULL OUTER JOIN cleared_grouped c ON c.check_number = w.check_number
    ),
    classified AS (
      SELECT
        p_brand AS brand,
        check_number,
        CASE
          -- NEW (top priority): a voided check that nonetheless cleared
          -- the bank. Fraud / bank error / mis-flagged in register —
          -- always worth surfacing as an alarm.
          WHEN is_voided AND cleared_count > 0                                    THEN 'voided_cashed'
          -- duplicate_clearing wins over orphan_cleared: a check cleared
          -- more than once is alarming regardless of whether we have a
          -- written record.
          WHEN cleared_count > 1                                                  THEN 'duplicate_clearing'
          WHEN written_amount IS NULL AND cleared_count > 0 AND NOT allowlisted   THEN 'orphan_cleared'
          WHEN written_amount IS NOT NULL AND cleared_count = 0                   THEN 'outstanding'
          WHEN cleared_count = 1 AND ABS(amount_delta) > 0.01                     THEN 'amount_mismatch'
          WHEN cleared_count = 1 AND ABS(amount_delta) <= 0.01                    THEN 'matched'
          ELSE NULL  -- allowlisted single-clearing orphans land here; skipped
        END::reconciliation_finding_type AS finding_type,
        written_amount, cleared_amount_total, cleared_count, amount_delta,
        written_date, cleared_dates, payee_label, event_id, event_label
      FROM joined
    ),
    upserted AS (
      INSERT INTO public.reconciliation_findings (
        brand, check_number, finding_type, written_amount, cleared_amount_total,
        cleared_count, amount_delta, written_date, cleared_dates, payee_label,
        event_id, event_label, last_matched_at
      )
      SELECT
        brand, check_number, finding_type, written_amount, cleared_amount_total,
        cleared_count, amount_delta, written_date, cleared_dates, payee_label,
        event_id, event_label, v_run_at
      FROM classified
      WHERE finding_type IS NOT NULL
      ON CONFLICT (brand, check_number, finding_type) DO UPDATE SET
        written_amount       = excluded.written_amount,
        cleared_amount_total = excluded.cleared_amount_total,
        cleared_count        = excluded.cleared_count,
        amount_delta         = excluded.amount_delta,
        written_date         = excluded.written_date,
        cleared_dates        = excluded.cleared_dates,
        payee_label          = excluded.payee_label,
        event_id             = excluded.event_id,
        event_label          = excluded.event_label,
        last_matched_at      = excluded.last_matched_at
      RETURNING finding_type
    )
  SELECT jsonb_build_object(
    'matched_count',            COUNT(*) FILTER (WHERE finding_type = 'matched'),
    'amount_mismatch_count',    COUNT(*) FILTER (WHERE finding_type = 'amount_mismatch'),
    'duplicate_clearing_count', COUNT(*) FILTER (WHERE finding_type = 'duplicate_clearing'),
    'orphan_cleared_count',     COUNT(*) FILTER (WHERE finding_type = 'orphan_cleared'),
    'outstanding_count',        COUNT(*) FILTER (WHERE finding_type = 'outstanding'),
    'voided_cashed_count',      COUNT(*) FILTER (WHERE finding_type = 'voided_cashed'),
    'run_at',                   v_run_at
  ) INTO v_counts
  FROM upserted;

  RETURN v_counts;
END $$;

GRANT EXECUTE ON FUNCTION public.reconciliation_run_match(TEXT) TO authenticated;

DO $$ BEGIN
  RAISE NOTICE 'reconciliation_run_match() updated to v4 — voided_cashed alarm now fires for any cleared check that was marked Voided in the register.';
END $$;
