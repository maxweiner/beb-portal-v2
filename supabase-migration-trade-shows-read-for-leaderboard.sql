-- ============================================================
-- Widen trade_shows + trade_show_staff SELECT RLS for the buyer
-- standings leaderboard.
--
-- The 2026 standings now counts completed trade-show days alongside
-- buying-event days (see lib/useTradeShowDays.ts). Computing per-
-- buyer day totals requires every authenticated user to be able to
-- read every (trade_show, trade_show_staff) row — same way the
-- existing leaderboard reads every (event, event_worker) row.
--
-- The pre-existing read policies (supabase-migration-multi-role-
-- phase-3-rls.sql) gated these tables on admin / superadmin /
-- sales_rep / is_my_partner — appropriate when they were sales-rep
-- back-office data, but too restrictive now that they feed a
-- buyer-visible widget.
--
-- WRITE policies are untouched (still admin/superadmin/partner).
-- Trade-show staffing / dates / venue info aren't sensitive — they
-- already appear on calendar overlays and public partner schedules
-- — so opening read to every authenticated user is consistent with
-- how buying-event data is already shared.
--
-- Safe to re-run.
-- ============================================================

DROP POLICY IF EXISTS trade_shows_read ON public.trade_shows;
CREATE POLICY trade_shows_read ON public.trade_shows
  FOR SELECT TO authenticated
  USING (TRUE);

DROP POLICY IF EXISTS trade_show_staff_read ON public.trade_show_staff;
CREATE POLICY trade_show_staff_read ON public.trade_show_staff
  FOR SELECT TO authenticated
  USING (TRUE);

DO $$ BEGIN
  RAISE NOTICE 'trade_shows + trade_show_staff SELECT widened to all authenticated users.';
END $$;
