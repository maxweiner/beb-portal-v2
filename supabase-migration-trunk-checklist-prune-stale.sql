-- ── Trunk Comms: prune > 7-day overdue checklist items ───────
-- Per partner request — old items that no one's going to act on
-- are clutter. One-shot delete of every open per-show item
-- whose due date is more than 7 days in the past.
--
-- Going forward, the dashboard widget filters at query time so
-- no item > 7 days overdue ever appears. If you need a recurring
-- delete cron later, it's a small addition. For now this is a
-- one-shot cleanup; new items naturally fall off the visible list
-- 7 days after their due date.
--
-- Safe to re-run.
-- ============================================================

DELETE FROM public.trunk_show_checklist_items
 WHERE is_completed = false
   AND due_date < (CURRENT_DATE - INTERVAL '7 days');

DO $$ BEGIN
  RAISE NOTICE 'Pruned trunk_show_checklist_items > 7 days overdue.';
END $$;
