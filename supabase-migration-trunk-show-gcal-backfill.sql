-- ── Trunk-show GCal: one-shot backfill ───────────────────────
-- PR D, final piece of the per-rep trunk-show calendar feature.
--
-- Enqueues a 'sync' row for every existing live trunk show so the
-- cron dispatcher fans them out into the assigned reps' Google
-- calendars on the next minute tick. Running shows that already
-- have an event link AND no pending sync are skipped, so this is
-- safe to re-run any time without queuing duplicates.
--
-- Reps without a provisioned trunk_show_calendar_id will hit the
-- 'rep_no_calendar' branch in the dispatcher and quietly mark
-- done. Once an admin provisions the rep's calendar (PR B) and
-- this migration is re-run (or the rep's existing trunk shows
-- are touched), they'll re-enqueue and sync.
--
-- Safe to re-run.
-- ============================================================

INSERT INTO public.trunk_show_gcal_sync_queue (trunk_show_id, action)
SELECT ts.id, 'sync'
  FROM public.trunk_shows ts
 WHERE ts.deleted_at IS NULL
   AND ts.status <> 'cancelled'
   AND NOT EXISTS (
     SELECT 1 FROM public.trunk_show_gcal_event_links link
      WHERE link.trunk_show_id = ts.id
   )
   AND NOT EXISTS (
     SELECT 1 FROM public.trunk_show_gcal_sync_queue q
      WHERE q.trunk_show_id = ts.id
        AND q.status IN ('pending', 'processing')
   );

DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
    FROM public.trunk_show_gcal_sync_queue
   WHERE status = 'pending'
     AND created_at > now() - interval '1 minute';
  RAISE NOTICE 'Trunk-show GCal backfill: % rows enqueued (will dispatch on next cron tick).', v_count;
END $$;
