-- ── Reconciliation matcher v3: duplicate_clearing wins ──
--
-- v2 had a CASE-order bug: a check with no written record but
-- cleared more than once was hitting the 'orphan_cleared' branch
-- before 'duplicate_clearing' (because both branches matched, and
-- orphan came first). That meant a real double-cashing of a
-- pre-app legacy check would silently classify as just another
-- orphan — no alert.
--
-- v3 reorders the CASE so duplicate_clearing wins regardless of
-- whether the check has a written record. Everything else is
-- unchanged from v2 (no temp tables, persists matched findings,
-- preserves user-set status across re-runs).
--
-- Safe to re-run.
-- ============================================================

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
      SELECT
        bc.check_number,
        bc.amount AS written_amount,
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
      SELECT
        check_number,
        SUM(written_amount) AS written_amount,
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
          -- duplicate_clearing wins: a check cleared more than once is
          -- the alarming case, regardless of whether we have a written
          -- record. (Previously orphan_cleared could mask this.)
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
    'outstanding_count',        COUNT(*) FILTER (WHERE finding_type = 'outstanding')
  ) INTO v_counts
  FROM upserted;

  -- Drop open findings whose issue resolved itself between runs.
  DELETE FROM public.reconciliation_findings
   WHERE brand = p_brand
     AND status = 'open'
     AND last_matched_at < v_run_at;

  RETURN jsonb_build_object('brand', p_brand, 'run_at', v_run_at)
       || COALESCE(v_counts, '{}'::jsonb);
END;
$$;

DO $$ BEGIN
  RAISE NOTICE 'Reconciliation matcher v3 installed (duplicate_clearing now wins over orphan_cleared).';
END $$;
