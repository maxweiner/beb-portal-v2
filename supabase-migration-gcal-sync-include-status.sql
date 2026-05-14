-- ============================================================
-- Google Calendar sync — include events.status in the queue
-- payload, and re-sync when status flips.
--
-- WHY
--   Events can be 'reserved' (Save the Date — tentative) vs.
--   'scheduled' (confirmed). The GCal calendar grid currently shows
--   both identically, so operators can't tell them apart without
--   opening each event. We want titles like
--     Sami Fine Jewelry (MW/NR/TB) (reserved)
--   for reserved events, and unchanged titles for scheduled/completed.
--
-- WHAT THIS DOES
--   1. Adds 'status' to every jsonb_build_object payload the trigger
--      emits so the dispatcher can read NEW.status from the queue
--      row instead of doing a second SELECT against events.
--   2. Adds NEW.status to the watched-columns diff so a reserved →
--      scheduled flip (or reverse) enqueues an update. Without this
--      the title would lag until some other watched column changed.
--   3. One-shot re-enqueue: every currently-reserved event that's
--      already on Google Calendar gets an 'update' row so its title
--      gains the (reserved) suffix within ~60 seconds. Idempotent.
--
-- Safe to re-run. The function is REPLACEd; the trigger binding is
-- unchanged. The companion dispatcher change reads p.status and
-- appends "(reserved)" when present.
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
    IF NEW.cancelled_at IS NOT NULL THEN
      RETURN NULL;
    END IF;
    v_payload := jsonb_build_object(
      'store_id', NEW.store_id,
      'store_name', NEW.store_name,
      'start_date', NEW.start_date,
      'workers', COALESCE(NEW.workers, '[]'::jsonb),
      'status', NEW.status::text
    );
    INSERT INTO gcal_sync_queue (event_id, brand, action, payload)
    VALUES (NEW.id, NEW.brand, 'create', v_payload);

  ELSIF TG_OP = 'UPDATE' THEN
    v_was_cancelled := OLD.cancelled_at IS NOT NULL;
    v_is_cancelled  := NEW.cancelled_at IS NOT NULL;

    -- 1. Transitioning INTO cancelled — enqueue delete.
    IF v_is_cancelled AND NOT v_was_cancelled THEN
      SELECT google_calendar_event_id INTO v_link
      FROM gcal_event_links WHERE event_id = NEW.id;
      IF v_link IS NOT NULL THEN
        INSERT INTO gcal_sync_queue (event_id, brand, action, google_calendar_event_id)
        VALUES (NEW.id, NEW.brand, 'delete', v_link);
      END IF;
      RETURN NULL;
    END IF;

    -- 2. Transitioning OUT of cancelled (un-cancel, defensive).
    IF v_was_cancelled AND NOT v_is_cancelled THEN
      v_payload := jsonb_build_object(
        'store_id', NEW.store_id, 'store_name', NEW.store_name,
        'start_date', NEW.start_date, 'workers', COALESCE(NEW.workers, '[]'::jsonb),
        'status', NEW.status::text
      );
      INSERT INTO gcal_sync_queue (event_id, brand, action, payload)
      VALUES (NEW.id, NEW.brand, 'create', v_payload);
      RETURN NULL;
    END IF;

    -- 3. Stays cancelled — never push.
    IF v_is_cancelled THEN
      RETURN NULL;
    END IF;

    -- 4. Brand changed: delete from old + create on new.
    IF OLD.brand IS DISTINCT FROM NEW.brand THEN
      SELECT google_calendar_event_id INTO v_link FROM gcal_event_links WHERE event_id = OLD.id;
      IF v_link IS NOT NULL THEN
        INSERT INTO gcal_sync_queue (event_id, brand, action, google_calendar_event_id)
        VALUES (OLD.id, OLD.brand, 'delete', v_link);
        DELETE FROM gcal_event_links WHERE event_id = OLD.id;
      END IF;
      v_payload := jsonb_build_object(
        'store_id', NEW.store_id, 'store_name', NEW.store_name,
        'start_date', NEW.start_date, 'workers', COALESCE(NEW.workers, '[]'::jsonb),
        'status', NEW.status::text
      );
      INSERT INTO gcal_sync_queue (event_id, brand, action, payload)
      VALUES (NEW.id, NEW.brand, 'create', v_payload);
      RETURN NULL;
    END IF;

    -- 5. Same brand, not cancelled — enqueue only on watched-column
    --    change. `status` is now watched so reserved↔scheduled flips
    --    push fresh titles.
    v_watched_changed :=
      NEW.store_id IS DISTINCT FROM OLD.store_id
      OR NEW.store_name IS DISTINCT FROM OLD.store_name
      OR NEW.start_date IS DISTINCT FROM OLD.start_date
      OR COALESCE(NEW.workers, '[]'::jsonb) IS DISTINCT FROM COALESCE(OLD.workers, '[]'::jsonb)
      OR NEW.status IS DISTINCT FROM OLD.status;

    IF v_watched_changed THEN
      SELECT google_calendar_event_id INTO v_link FROM gcal_event_links WHERE event_id = NEW.id;
      v_payload := jsonb_build_object(
        'store_id', NEW.store_id, 'store_name', NEW.store_name,
        'start_date', NEW.start_date, 'workers', COALESCE(NEW.workers, '[]'::jsonb),
        'status', NEW.status::text
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

-- ============================================================
-- One-shot relabel: every reserved event already linked to Google
-- Calendar gets an 'update' row so its title gains "(reserved)"
-- within ~60s. Skips cancelled rows (they shouldn't be on the
-- calendar anyway).
-- ============================================================
INSERT INTO gcal_sync_queue (event_id, brand, action, google_calendar_event_id, payload)
SELECT
  e.id,
  e.brand,
  'update',
  l.google_calendar_event_id,
  jsonb_build_object(
    'store_id', e.store_id,
    'store_name', e.store_name,
    'start_date', e.start_date,
    'workers', COALESCE(e.workers, '[]'::jsonb),
    'status', e.status::text
  )
FROM events e
JOIN gcal_event_links l ON l.event_id = e.id
WHERE e.status = 'reserved'
  AND e.cancelled_at IS NULL;

DO $$
DECLARE
  relabel_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO relabel_count
  FROM events e
  JOIN gcal_event_links l ON l.event_id = e.id
  WHERE e.status = 'reserved'
    AND e.cancelled_at IS NULL;
  RAISE NOTICE 'enqueue_gcal_sync now stamps status into payload. Enqueued % update row(s) so currently-reserved events get the (reserved) suffix on their next cron pass.', relabel_count;
END $$;
