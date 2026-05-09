-- ── events.status: promote qualifying past events to 'completed' ──
--
-- Step 2 of 2. Run AFTER -1-enum.sql and after that statement has
-- committed (in Supabase SQL Editor that means hitting Run twice or
-- splitting into two pasted runs).
--
-- Promotion rule: status='scheduled' AND the event ended at least one
-- day ago (start_date + 2 < today) AND it has 3 event_days rows with
-- any non-zero purchases / dollars10 / dollars5. Mirrors the
-- `dayHasData` helper in lib/eventSpend.ts so app code and DB
-- agree on what "filled out" means.
--
-- Also installs `events_promote_completed()` for the daily cron to
-- reuse going forward.
--
-- Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public.events_promote_completed() RETURNS INT AS $$
DECLARE
  n INT;
BEGIN
  WITH filled AS (
    SELECT d.event_id, COUNT(*) AS days_with_data
      FROM public.event_days d
     WHERE COALESCE(d.purchases, 0) > 0
        OR COALESCE(d.dollars10, 0) > 0
        OR COALESCE(d.dollars5,  0) > 0
     GROUP BY d.event_id
  )
  UPDATE public.events e
     SET status = 'completed'::event_status
    FROM filled f
   WHERE f.event_id = e.id
     AND f.days_with_data >= 3
     AND e.status = 'scheduled'
     AND e.start_date IS NOT NULL
     AND e.start_date + INTERVAL '2 days' < CURRENT_DATE;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.events_promote_completed() IS
  'Promotes scheduled buying events to status=completed when the event ended at least 1 day ago and has 3 event_days with non-zero data. Returns the number of rows updated. Called by /api/cron/promote-events-completed daily and runnable manually for backfills.';

-- One-shot backfill for existing rows.
SELECT public.events_promote_completed() AS rows_promoted;

DO $$ BEGIN
  RAISE NOTICE 'events_promote_completed() installed; backfill complete (see "rows_promoted" output above).';
END $$;
