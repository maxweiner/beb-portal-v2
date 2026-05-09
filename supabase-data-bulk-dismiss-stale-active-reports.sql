-- ── One-shot bulk dismiss of stale active expense reports ──
--
-- Mass-marks expense_reports.status='active' rows whose parent event /
-- trunk show / trade show is more than 30 days in the past. The
-- parent date used is start_date for buying events and end_date for
-- shows. Status only flips on drafts — submitted / approved / paid /
-- already-no_expenses reports are not touched.
--
-- Idempotent: re-running has no effect (the update predicate matches
-- only status='active', and we just flipped them).
--
-- Run via Supabase SQL Editor.
-- ============================================================

UPDATE public.expense_reports
   SET status = 'no_expenses'::expense_report_status
 WHERE status = 'active'
   AND id IN (
     SELECT er.id
       FROM public.expense_reports er
       LEFT JOIN public.events       e   ON e.id   = er.event_id
       LEFT JOIN public.trunk_shows  ts  ON ts.id  = er.trunk_show_id
       LEFT JOIN public.trade_shows  tds ON tds.id = er.trade_show_id
      WHERE er.status = 'active'
        AND COALESCE(e.start_date, ts.end_date, tds.end_date)
            < CURRENT_DATE - INTERVAL '30 days'
   )
RETURNING id, user_id, event_id, trunk_show_id, trade_show_id;
