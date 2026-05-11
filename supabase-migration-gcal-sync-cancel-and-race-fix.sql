-- ============================================================
-- Google Calendar sync — fix two bugs
--
-- BUG 1: Cancelled events stay on Google Calendar
--   The events->gcal_sync_queue trigger only watched store_id,
--   store_name, start_date, and workers for change. cancelled_at
--   wasn't in the watch list, so soft-cancellation (which is just
--   an UPDATE setting cancelled_at = now()) never enqueued a sync
--   row. The Google Calendar event stayed put.
--
-- BUG 2: Duplicates on re-sync
--   When an events row was inserted/updated twice in rapid
--   succession before the cron processed the first row, both
--   queue rows were marked action='create' (because at trigger
--   time, gcal_event_links was empty for that event). The cron
--   then created two Google Calendar events. This is a race; the
--   dispatcher needs to re-check the link table at PROCESS time,
--   but we also tighten the trigger to coalesce.
--
-- Fixes here:
--   - Trigger now watches cancelled_at. NULL→non-NULL enqueues a
--     delete. non-NULL→NULL enqueues a create (un-cancel, defensive
--     even though the UI is one-way).
--   - If NEW.cancelled_at IS NOT NULL, never enqueue a create or
--     update — a cancelled event must not be on the calendar
--     regardless of which other column changed.
--   - One-shot backfill: every event that's currently cancelled
--     but still has a gcal_event_links row gets a delete queue
--     row inserted so the cron cleans it within the next minute.
--
-- The companion dispatcher fix (defensive re-check of
-- gcal_event_links at process time) lives in lib/gcal/dispatcher.ts
-- in the same PR. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION enqueue_gcal_sync()
RETURNS TRIGGER AS $$
DECLARE
  v_payload JSONB;
  v_link TEXT;
  v_was_cancelled BOOLEAN;
  v_is_cancelled  BOOLEAN;
  v_watched_changed BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Edge case: an INSERT with cancelled_at already set (data
    -- import / restore). Skip — there's nothing on Google to
    -- create or delete yet.
    IF NEW.cancelled_at IS NOT NULL THEN
      RETURN NULL;
    END IF;
    v_payload := jsonb_build_object(
      'store_id', NEW.store_id,
      'store_name', NEW.store_name,
      'start_date', NEW.start_date,
      'workers', COALESCE(NEW.workers, '[]'::jsonb)
    );
    INSERT INTO gcal_sync_queue (event_id, brand, action, payload)
    VALUES (NEW.id, NEW.brand, 'create', v_payload);

  ELSIF TG_OP = 'UPDATE' THEN
    v_was_cancelled := OLD.cancelled_at IS NOT NULL;
    v_is_cancelled  := NEW.cancelled_at IS NOT NULL;

    -- 1. Transitioning INTO cancelled — enqueue delete (with the
    --    current link if any). Skip every other branch.
    IF v_is_cancelled AND NOT v_was_cancelled THEN
      SELECT google_calendar_event_id INTO v_link
      FROM gcal_event_links WHERE event_id = NEW.id;
      IF v_link IS NOT NULL THEN
        INSERT INTO gcal_sync_queue (event_id, brand, action, google_calendar_event_id)
        VALUES (NEW.id, NEW.brand, 'delete', v_link);
      END IF;
      RETURN NULL;
    END IF;

    -- 2. Transitioning OUT of cancelled (un-cancel, defensive — the
    --    UI is one-way today but allow it). Enqueue a create; the
    --    dispatcher's defensive re-check will switch to update if a
    --    stale link still happens to exist.
    IF v_was_cancelled AND NOT v_is_cancelled THEN
      v_payload := jsonb_build_object(
        'store_id', NEW.store_id, 'store_name', NEW.store_name,
        'start_date', NEW.start_date, 'workers', COALESCE(NEW.workers, '[]'::jsonb)
      );
      INSERT INTO gcal_sync_queue (event_id, brand, action, payload)
      VALUES (NEW.id, NEW.brand, 'create', v_payload);
      RETURN NULL;
    END IF;

    -- 3. Event is currently cancelled and stays cancelled — do not
    --    push any update to Google. Without this short-circuit,
    --    editing notes or workers on a cancelled event would
    --    re-create the calendar entry.
    IF v_is_cancelled THEN
      RETURN NULL;
    END IF;

    -- 4. Brand changed: delete from old calendar + create on new.
    IF OLD.brand IS DISTINCT FROM NEW.brand THEN
      SELECT google_calendar_event_id INTO v_link FROM gcal_event_links WHERE event_id = OLD.id;
      IF v_link IS NOT NULL THEN
        INSERT INTO gcal_sync_queue (event_id, brand, action, google_calendar_event_id)
        VALUES (OLD.id, OLD.brand, 'delete', v_link);
        DELETE FROM gcal_event_links WHERE event_id = OLD.id;
      END IF;
      v_payload := jsonb_build_object(
        'store_id', NEW.store_id, 'store_name', NEW.store_name,
        'start_date', NEW.start_date, 'workers', COALESCE(NEW.workers, '[]'::jsonb)
      );
      INSERT INTO gcal_sync_queue (event_id, brand, action, payload)
      VALUES (NEW.id, NEW.brand, 'create', v_payload);
      RETURN NULL;
    END IF;

    -- 5. Same brand, not cancelled, transitioning in neither
    --    direction — only enqueue if a watched column actually
    --    changed.
    v_watched_changed :=
      NEW.store_id IS DISTINCT FROM OLD.store_id
      OR NEW.store_name IS DISTINCT FROM OLD.store_name
      OR NEW.start_date IS DISTINCT FROM OLD.start_date
      OR COALESCE(NEW.workers, '[]'::jsonb) IS DISTINCT FROM COALESCE(OLD.workers, '[]'::jsonb);

    IF v_watched_changed THEN
      SELECT google_calendar_event_id INTO v_link FROM gcal_event_links WHERE event_id = NEW.id;
      v_payload := jsonb_build_object(
        'store_id', NEW.store_id, 'store_name', NEW.store_name,
        'start_date', NEW.start_date, 'workers', COALESCE(NEW.workers, '[]'::jsonb)
      );
      INSERT INTO gcal_sync_queue (event_id, brand, action, google_calendar_event_id, payload)
      VALUES (
        NEW.id, NEW.brand,
        CASE WHEN v_link IS NULL THEN 'create' ELSE 'update' END,
        v_link, v_payload
      );
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    SELECT google_calendar_event_id INTO v_link FROM gcal_event_links WHERE event_id = OLD.id;
    IF v_link IS NOT NULL THEN
      INSERT INTO gcal_sync_queue (event_id, brand, action, google_calendar_event_id)
      VALUES (OLD.id, OLD.brand, 'delete', v_link);
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger already exists from the previous migration; we replaced
-- the function above so nothing else to do here. (Re-binding the
-- trigger would be a no-op.)

-- ============================================================
-- One-shot cleanup: every event that's currently cancelled but
-- still has a Google Calendar link row gets a delete enqueued.
-- The cron drains pending deletes within ~60 seconds. Idempotent —
-- if a delete is already pending for the same event, we add one
-- more; the dispatcher tolerates a 404 from Google on the second
-- pass.
-- ============================================================
INSERT INTO gcal_sync_queue (event_id, brand, action, google_calendar_event_id)
SELECT
  e.id,
  e.brand,
  'delete',
  l.google_calendar_event_id
FROM events e
JOIN gcal_event_links l ON l.event_id = e.id
WHERE e.cancelled_at IS NOT NULL;

DO $$
DECLARE
  cleanup_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO cleanup_count
  FROM events e
  JOIN gcal_event_links l ON l.event_id = e.id
  WHERE e.cancelled_at IS NOT NULL;
  RAISE NOTICE 'Updated enqueue_gcal_sync to handle cancelled_at. Queued % delete row(s) for already-cancelled events still linked to Google Calendar.', cleanup_count;
END $$;
