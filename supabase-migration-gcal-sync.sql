-- ============================================================
-- One-way sync: portal events -> Google Calendar.
--
-- Two calendars total (one per brand). Settings live in
-- gcal_integration_settings keyed on brand. Mapping between a portal
-- event and its Google Calendar event id lives in gcal_event_links so
-- writes from the dispatcher don't re-fire the events trigger and
-- create an infinite enqueue loop.
--
-- A Postgres trigger on events fires after INSERT / UPDATE / DELETE
-- and writes to gcal_sync_queue. A Vercel cron every minute drains
-- the queue (lib/gcal/dispatcher.ts).
-- ============================================================

-- 1. Per-brand integration settings
CREATE TABLE IF NOT EXISTS gcal_integration_settings (
  brand TEXT PRIMARY KEY CHECK (brand IN ('beb','liberty')),
  enabled BOOLEAN NOT NULL DEFAULT false,
  calendar_id TEXT,
  include_buyer_names BOOLEAN NOT NULL DEFAULT true,
  last_full_sync_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO gcal_integration_settings (brand) VALUES ('beb'), ('liberty')
  ON CONFLICT (brand) DO NOTHING;

ALTER TABLE gcal_integration_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read gcal_integration_settings"
  ON gcal_integration_settings FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role IN ('admin','superadmin')));

CREATE POLICY "Superadmins write gcal_integration_settings"
  ON gcal_integration_settings FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role = 'superadmin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role = 'superadmin'));

-- 2. Mapping between portal event and Google Calendar event
CREATE TABLE IF NOT EXISTS gcal_event_links (
  event_id UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  brand TEXT NOT NULL CHECK (brand IN ('beb','liberty')),
  google_calendar_event_id TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE gcal_event_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read gcal_event_links"
  ON gcal_event_links FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role IN ('admin','superadmin')));

-- 3. Sync queue
CREATE TABLE IF NOT EXISTS gcal_sync_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID,                       -- NULL allowed: deletes can outlive the event row
  brand TEXT NOT NULL CHECK (brand IN ('beb','liberty')),
  action TEXT NOT NULL CHECK (action IN ('create','update','delete')),
  google_calendar_event_id TEXT,       -- captured at enqueue time for deletes
  payload JSONB,                       -- snapshot of event fields for create/update
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','done','failed')),
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_gcal_queue_due
  ON gcal_sync_queue (scheduled_for) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_gcal_queue_event ON gcal_sync_queue (event_id);
CREATE INDEX IF NOT EXISTS idx_gcal_queue_status ON gcal_sync_queue (status, created_at DESC);

ALTER TABLE gcal_sync_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read gcal_sync_queue"
  ON gcal_sync_queue FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role IN ('admin','superadmin')));

-- 4. Trigger: auto-enqueue on every events mutation.
--    Keeps writes to gcal_event_links separate so the dispatcher's
--    link updates do NOT re-fire this trigger.
CREATE OR REPLACE FUNCTION enqueue_gcal_sync()
RETURNS TRIGGER AS $$
DECLARE
  v_payload JSONB;
  v_link TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_payload := jsonb_build_object(
      'store_id', NEW.store_id,
      'store_name', NEW.store_name,
      'start_date', NEW.start_date,
      'workers', COALESCE(NEW.workers, '[]'::jsonb)
    );
    INSERT INTO gcal_sync_queue (event_id, brand, action, payload)
    VALUES (NEW.id, NEW.brand, 'create', v_payload);

  ELSIF TG_OP = 'UPDATE' THEN
    -- Brand changed: delete from old calendar + create on new.
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
    ELSE
      -- Skip if no relevant fields changed (e.g. only updated_at touched).
      IF NEW.store_id IS DISTINCT FROM OLD.store_id
         OR NEW.store_name IS DISTINCT FROM OLD.store_name
         OR NEW.start_date IS DISTINCT FROM OLD.start_date
         OR COALESCE(NEW.workers, '[]'::jsonb) IS DISTINCT FROM COALESCE(OLD.workers, '[]'::jsonb)
      THEN
        SELECT google_calendar_event_id INTO v_link FROM gcal_event_links WHERE event_id = NEW.id;
        v_payload := jsonb_build_object(
          'store_id', NEW.store_id, 'store_name', NEW.store_name,
          'start_date', NEW.start_date, 'workers', COALESCE(NEW.workers, '[]'::jsonb)
        );
        INSERT INTO gcal_sync_queue (event_id, brand, action, google_calendar_event_id, payload)
        VALUES (NEW.id, NEW.brand, CASE WHEN v_link IS NULL THEN 'create' ELSE 'update' END, v_link, v_payload);
      END IF;
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

DROP TRIGGER IF EXISTS trg_events_gcal_sync ON events;
CREATE TRIGGER trg_events_gcal_sync
AFTER INSERT OR UPDATE OR DELETE ON events
FOR EACH ROW EXECUTE FUNCTION enqueue_gcal_sync();

-- 5. RPC: claim due rows atomically (mirrors notifications pattern)
CREATE OR REPLACE FUNCTION claim_due_gcal_syncs(batch_size INT DEFAULT 25)
RETURNS SETOF gcal_sync_queue
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT id FROM gcal_sync_queue
    WHERE status = 'pending' AND scheduled_for <= now()
    ORDER BY scheduled_for ASC
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE gcal_sync_queue q
  SET status = 'processing', updated_at = now()
  FROM due
  WHERE q.id = due.id
  RETURNING q.*;
END;
$$;
