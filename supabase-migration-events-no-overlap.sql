-- ── Prevent overlapping non-cancelled events at the same store ──
-- Bug from the field: Burkes Jewelers showed up twice on the
-- schedule. Most likely cause was a double-click on the Create
-- Event button before the React disabled-state took effect. The
-- client got a useRef lock; this is the server-side belt-and-
-- suspenders that catches:
--   - Direct supabase-js inserts that bypass the modal
--   - Genuine date overlaps even from separate forms
--   - Bulk imports that might accidentally collide
--
-- Rule: a store can't have two non-cancelled events whose 3-day
-- windows touch. Cancelled events are exempt — that's how
-- rescheduling works (cancel old, create new on adjacent dates).
--
-- Trigger over EXCLUDE constraint because the latter requires
-- btree_gist + treats range overlap as the unique sense, which
-- doesn't distinguish cancelled rows cleanly.
--
-- Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public.events_block_overlap_per_store() RETURNS TRIGGER AS $$
DECLARE
  conflict RECORD;
  new_start DATE;
  new_end   DATE;
BEGIN
  -- Cancelled events can sit on any date — skip the check.
  IF NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;
  IF NEW.start_date IS NULL THEN
    RETURN NEW;
  END IF;

  new_start := NEW.start_date;
  new_end   := NEW.start_date + INTERVAL '2 days'; -- 3-day buying window inclusive

  SELECT id, store_name, start_date INTO conflict
  FROM public.events
  WHERE store_id = NEW.store_id
    AND id      <> NEW.id
    AND status  <> 'cancelled'
    AND start_date IS NOT NULL
    -- Two ranges overlap when start_a <= end_b AND end_a >= start_b.
    AND start_date                <= new_end::DATE
    AND start_date + INTERVAL '2 days' >= new_start
  LIMIT 1;

  IF conflict.id IS NOT NULL THEN
    RAISE EXCEPTION
      'Store already has an active event % – % overlapping the chosen dates. Cancel that event first or pick a different start date.',
      conflict.store_name, conflict.start_date
      USING ERRCODE = '23505'; -- unique_violation; surfaces nicely in clients
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_events_block_overlap ON public.events;
CREATE TRIGGER trg_events_block_overlap
  BEFORE INSERT OR UPDATE OF store_id, start_date, status ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.events_block_overlap_per_store();

DO $$ BEGIN
  RAISE NOTICE 'events overlap-prevention trigger installed.';
END $$;
