-- ── Reconciliation matcher: fix bogus "Store commission" label ──
--
-- The previous matcher branched on `bc.entry_id IS NULL` to decide
-- payee_kind:
--   CASE WHEN bc.entry_id IS NULL THEN 'Store commission' ELSE 'Seller' END
--
-- That's wrong. `entry_id IS NULL` only means a buyer_checks row
-- isn't tied to a per-seller entry form row — it does NOT mean the
-- check is the event's store-commission check. The real signal for
-- a commission check is `buyer_checks.commission_note`, which the
-- end-of-event flow populates only when the user explicitly tags
-- a single check as the commission payment.
--
-- New label rules for buyer_checks rows:
--   • commission_note IS NOT NULL  →  'Commission check'
--   • customer_name   IS NOT NULL  →  customer_name           (the seller)
--   • else                          →  NULL                    (UI falls back
--                                                              to event_label
--                                                              which already
--                                                              carries the
--                                                              store name)
--
-- Legacy event_days.store_commission_check_* rows stay labeled
-- 'Store commission' — that table column IS the old explicit
-- per-day store-commission flow.
--
-- Existing findings rows in reconciliation_findings keep their
-- stale payee_label until the matcher is re-run. The ON CONFLICT
-- clause already updates payee_label, so a single click of
-- "Re-run match" in the reconciliation UI refreshes them in place,
-- preserving status / note / resolved_by / resolved_at.
-- ============================================================

CREATE OR REPLACE FUNCTION public.reconciliation_run_match(p_brand TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_at      TIMESTAMPTZ := now();
  v_matched     INT;
  v_mismatch    INT;
  v_duplicate   INT;
  v_orphan      INT;
  v_outstanding INT;
BEGIN
  CREATE TEMP TABLE _tmp_recon_findings ON COMMIT DROP AS
  WITH written_checks AS (
    -- (a) buyer_checks: per-seller payments + end-of-event commission
    SELECT
      bc.check_number,
      bc.amount AS written_amount,
      e.id      AS event_id,
      e.store_name AS event_store_name,
      e.start_date AS event_start_date,
      (e.start_date + ((COALESCE(bc.day_number, 1) - 1) * INTERVAL '1 day'))::date AS written_date,
      CASE
        WHEN bc.commission_note IS NOT NULL AND length(trim(bc.commission_note)) > 0
          THEN 'Commission check'
        WHEN bc.customer_name IS NOT NULL AND length(trim(bc.customer_name)) > 0
          THEN bc.customer_name
        ELSE NULL
      END AS payee_kind
    FROM public.buyer_checks bc
    JOIN public.events e ON e.id = bc.event_id
    WHERE e.brand = p_brand
      AND bc.check_number IS NOT NULL
      AND bc.check_number <> ''

    UNION ALL

    -- (b) event_days store-commission check (older flow). These rows
    -- ARE always commission by definition, so the literal stays.
    SELECT
      ed.store_commission_check_number AS check_number,
      ed.store_commission_check_amount AS written_amount,
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
    -- Same check number can appear twice (rare but possible — entry-level
    -- + event-day-level clash). Take the most recent event for the label,
    -- sum amounts so the match comparison stays correct.
    SELECT
      check_number,
      SUM(written_amount) AS written_amount,
      (array_agg(event_id      ORDER BY event_start_date DESC NULLS LAST))[1] AS event_id,
      (array_agg(event_store_name ORDER BY event_start_date DESC NULLS LAST))[1] AS event_store_name,
      MAX(event_start_date)::date AS event_start_date,
      MAX(written_date)::date     AS written_date,
      (array_agg(payee_kind    ORDER BY event_start_date DESC NULLS LAST))[1] AS payee_kind
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
        WHEN written_amount IS NULL AND cleared_count > 0 AND NOT allowlisted THEN 'orphan_cleared'
        WHEN written_amount IS NOT NULL AND cleared_count = 0 THEN 'outstanding'
        WHEN cleared_count > 1 THEN 'duplicate_clearing'
        WHEN cleared_count = 1 AND ABS(amount_delta) > 0.01 THEN 'amount_mismatch'
        WHEN cleared_count = 1 AND ABS(amount_delta) <= 0.01 THEN 'matched'
        ELSE NULL  -- allowlisted orphans land here; skip
      END::reconciliation_finding_type AS finding_type,
      written_amount, cleared_amount_total, cleared_count, amount_delta,
      written_date, cleared_dates, payee_label, event_id, event_label
    FROM joined
  )
  SELECT * FROM classified WHERE finding_type IS NOT NULL;

  SELECT COUNT(*) FILTER (WHERE finding_type = 'matched')            INTO v_matched     FROM _tmp_recon_findings;
  SELECT COUNT(*) FILTER (WHERE finding_type = 'amount_mismatch')    INTO v_mismatch    FROM _tmp_recon_findings;
  SELECT COUNT(*) FILTER (WHERE finding_type = 'duplicate_clearing') INTO v_duplicate   FROM _tmp_recon_findings;
  SELECT COUNT(*) FILTER (WHERE finding_type = 'orphan_cleared')     INTO v_orphan      FROM _tmp_recon_findings;
  SELECT COUNT(*) FILTER (WHERE finding_type = 'outstanding')        INTO v_outstanding FROM _tmp_recon_findings;

  INSERT INTO public.reconciliation_findings (
    brand, check_number, finding_type, written_amount, cleared_amount_total,
    cleared_count, amount_delta, written_date, cleared_dates, payee_label,
    event_id, event_label, last_matched_at
  )
  SELECT
    brand, check_number, finding_type, written_amount, cleared_amount_total,
    cleared_count, amount_delta, written_date, cleared_dates, payee_label,
    event_id, event_label, v_run_at
  FROM _tmp_recon_findings
  WHERE finding_type <> 'matched'
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
    last_matched_at      = excluded.last_matched_at;
    -- status, note, resolved_by, resolved_at intentionally NOT updated

  DELETE FROM public.reconciliation_findings
   WHERE brand = p_brand
     AND status = 'open'
     AND last_matched_at < v_run_at;

  RETURN jsonb_build_object(
    'brand',                    p_brand,
    'run_at',                   v_run_at,
    'matched_count',            v_matched,
    'amount_mismatch_count',    v_mismatch,
    'duplicate_clearing_count', v_duplicate,
    'orphan_cleared_count',     v_orphan,
    'outstanding_count',        v_outstanding
  );
END;
$$;

COMMENT ON FUNCTION public.reconciliation_run_match(TEXT) IS
  'Re-runs reconciliation matching for one brand. Commission label is sourced from buyer_checks.commission_note only; legacy event_days store-commission rows keep their literal label. Upserts non-matched findings, preserves user-set status, drops open findings that resolved themselves.';

-- Refresh existing findings in place so the bogus "Store commission"
-- labels disappear without waiting for the next nightly run.
SELECT public.reconciliation_run_match('beb');
SELECT public.reconciliation_run_match('liberty');

DO $$ BEGIN
  RAISE NOTICE 'Commission-label fix applied + matcher re-run for both brands.';
END $$;
