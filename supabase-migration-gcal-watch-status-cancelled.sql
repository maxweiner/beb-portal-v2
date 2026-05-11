-- ============================================================
-- Google Calendar sync — also watch `status='cancelled'`, not just
-- `cancelled_at`.
--
-- Background. PR #552's trigger watched `cancelled_at` going
-- NULL → not-NULL to enqueue a delete. That works for any event
-- cancelled *after* that migration ran. But events that were
-- cancelled long ago via `status='cancelled'` alone (without ever
-- setting `cancelled_at`) sit in the database with the Google
-- Calendar entry still present — and the trigger doesn't notice
-- them because `cancelled_at` never changed.
--
-- We don't want to change *how* we maintain cancelled events
-- (history + cancellation_reason + cascade flow all key off the
-- existing schema). Instead, broaden the trigger so EITHER signal
-- counts as "cancelled":
--
--   v_was_cancelled := OLD.status = 'cancelled' OR OLD.cancelled_at IS NOT NULL;
--   v_is_cancelled  := NEW.status = 'cancelled' OR NEW.cancelled_at IS NOT NULL;
--
-- Then re-run the same branches as before: transition into
-- cancelled → enqueue delete; transition out → enqueue create;
-- currently cancelled → never enqueue create/update.
--
-- One-shot backfill covers existing rows that the previous
-- migration missed: any event whose `status='cancelled'` (with or
-- without a `cancelled_at`) that still has a gcal_event_links
-- row gets a delete queued. The cron drains within a minute.
--
-- Safe to re-run.
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
    -- Skip insertions that arrive already cancelled (data import).
    IF NEW.status = 'cancelled' OR NEW.cancelled_at IS NOT NULL THEN
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
    -- EITHER signal means cancelled. Detect transitions.
    v_was_cancelled := (OLD.status = 'cancelled') OR (OLD.cancelled_at IS NOT NULL);
    v_is_cancelled  := (NEW.status = 'cancelled') OR (NEW.cancelled_at IS NOT NULL);

    -- 1. Transitioning INTO cancelled — enqueue delete (with the
    --    current link if any).
    IF v_is_cancelled AND NOT v_was_cancelled THEN
      SELECT google_calendar_event_id INTO v_link
      FROM gcal_event_links WHERE event_id = NEW.id;
      IF v_link IS NOT NULL THEN
        INSERT INTO gcal_sync_queue (event_id, brand, action, google_calendar_event_id)
        VALUES (NEW.id, NEW.brand, 'delete', v_link);
      END IF;
      RETURN NULL;
    END IF;

    -- 2. Transitioning OUT of cancelled (un-cancel). UI is one-way
    --    today but the trigger handles it defensively.
    IF v_was_cancelled AND NOT v_is_cancelled THEN
      v_payload := jsonb_build_object(
        'store_id', NEW.store_id, 'store_name', NEW.store_name,
        'start_date', NEW.start_date, 'workers', COALESCE(NEW.workers, '[]'::jsonb)
      );
      INSERT INTO gcal_sync_queue (event_id, brand, action, payload)
      VALUES (NEW.id, NEW.brand, 'create', v_payload);
      RETURN NULL;
    END IF;

    -- 3. Currently cancelled and staying cancelled — never push to
    --    Google. Without this short-circuit, editing notes/workers
    --    on a cancelled event would re-create the calendar entry.
    IF v_is_cancelled THEN
      RETURN NULL;
    END IF;

    -- 4. Brand changed: delete from old, create on new.
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
    --    direction — only enqueue when a watched column changed.
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

-- ============================================================
-- One-shot backfill: any event currently cancelled by status OR
-- cancelled_at that still has a gcal_event_links row → enqueue
-- delete. Idempotent — if a delete is already pending for the
-- same event, we add one more; the dispatcher tolerates a 404 on
-- the second pass.
-- ============================================================
INSERT INTO gcal_sync_queue (event_id, brand, action, google_calendar_event_id)
SELECT
  e.id,
  e.brand,
  'delete',
  l.google_calendar_event_id
FROM events e
JOIN gcal_event_links l ON l.event_id = e.id
WHERE e.status = 'cancelled' OR e.cancelled_at IS NOT NULL;

DO $$
DECLARE
  n BIGINT;
BEGIN
  SELECT COUNT(*) INTO n
  FROM events e
  JOIN gcal_event_links l ON l.event_id = e.id
  WHERE e.status = 'cancelled' OR e.cancelled_at IS NOT NULL;
  RAISE NOTICE 'Trigger now treats status=''cancelled'' the same as cancelled_at IS NOT NULL. Queued % delete row(s) for cancelled events still linked to Google Calendar.', n;
END $$;
