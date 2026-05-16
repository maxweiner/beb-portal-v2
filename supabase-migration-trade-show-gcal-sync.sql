-- ============================================================
-- Trade-show Google Calendar sync (org-wide single calendar)
--
-- Architecture mirrors the trunk-show sync (already shipped) but
-- writes to a single org-wide calendar instead of per-rep calendars.
-- The whole company sees the same trade-show schedule. Spec
-- 2026-05-16: Max creates one Google Calendar, shares it with the
-- existing service account, pastes the calendar ID into Settings —
-- everything else is the same trigger → queue → cron → dispatcher
-- flow as buying events and trunk shows.
--
-- Tables added:
--   - trade_show_gcal_settings        (single row, org-wide config)
--   - trade_show_gcal_event_links     (dedup link, one per trade show)
--   - trade_show_gcal_sync_queue      (mutation queue)
--
-- Plus the trigger on trade_shows, the claim RPC for the cron, and
-- a one-shot backfill row in trade_show_gcal_settings (disabled
-- until Max pastes the calendar ID).
--
-- Safe to re-run. Idempotent.
-- ============================================================

-- ── 1. Settings (single org-wide row) ────────────────────────
-- One row. id is fixed at 1 so callers can always `WHERE id = 1`
-- without scanning. Created here so the Settings panel can read
-- without an "if not exists" upsert dance.
CREATE TABLE IF NOT EXISTS public.trade_show_gcal_settings (
  id                  INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled             BOOLEAN NOT NULL DEFAULT FALSE,
  calendar_id         TEXT,
  last_full_sync_at   TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.trade_show_gcal_settings (id, enabled, calendar_id)
VALUES (1, FALSE, NULL)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.trade_show_gcal_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read trade_show_gcal_settings" ON public.trade_show_gcal_settings;
CREATE POLICY "Admins read trade_show_gcal_settings"
  ON public.trade_show_gcal_settings FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_id = auth.uid() AND u.role IN ('admin','superadmin')
  ));

DROP POLICY IF EXISTS "Superadmins write trade_show_gcal_settings" ON public.trade_show_gcal_settings;
CREATE POLICY "Superadmins write trade_show_gcal_settings"
  ON public.trade_show_gcal_settings FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_id = auth.uid() AND u.role = 'superadmin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_id = auth.uid() AND u.role = 'superadmin'
  ));

-- ── 2. Event link (dedup, one per trade show) ────────────────
CREATE TABLE IF NOT EXISTS public.trade_show_gcal_event_links (
  trade_show_id UUID PRIMARY KEY REFERENCES public.trade_shows(id) ON DELETE CASCADE,
  calendar_id TEXT NOT NULL,
  google_calendar_event_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trade_show_gcal_links_calendar
  ON public.trade_show_gcal_event_links (calendar_id);

ALTER TABLE public.trade_show_gcal_event_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read trade_show_gcal_event_links" ON public.trade_show_gcal_event_links;
CREATE POLICY "Admins read trade_show_gcal_event_links"
  ON public.trade_show_gcal_event_links FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_id = auth.uid() AND u.role IN ('admin','superadmin')
  ));

-- ── 3. Sync queue ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trade_show_gcal_sync_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_show_id UUID,                  -- NULL allowed: deletes can outlive the row
  action TEXT NOT NULL CHECK (action IN ('sync','delete')),
  -- For deletes, snapshot of where the Google event lived at the
  -- moment of trigger fire: { calendar_id, google_event_id }.
  snapshot JSONB,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','done','failed')),
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_trade_gcal_queue_due
  ON public.trade_show_gcal_sync_queue (scheduled_for) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_trade_gcal_queue_show
  ON public.trade_show_gcal_sync_queue (trade_show_id);
CREATE INDEX IF NOT EXISTS idx_trade_gcal_queue_status
  ON public.trade_show_gcal_sync_queue (status, created_at DESC);

ALTER TABLE public.trade_show_gcal_sync_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read trade_show_gcal_sync_queue" ON public.trade_show_gcal_sync_queue;
CREATE POLICY "Admins read trade_show_gcal_sync_queue"
  ON public.trade_show_gcal_sync_queue FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_id = auth.uid() AND u.role IN ('admin','superadmin')
  ));

-- ── 4. Trigger: enqueue sync rows on every trade_shows mutation ──
CREATE OR REPLACE FUNCTION public.enqueue_trade_show_gcal_sync()
RETURNS TRIGGER AS $$
DECLARE
  v_link RECORD;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.trade_show_gcal_sync_queue (trade_show_id, action)
    VALUES (NEW.id, 'sync');

  ELSIF TG_OP = 'UPDATE' THEN
    -- Re-sync when any field that affects the calendar event's
    -- title / time / location / description changes. Add to this
    -- list when new fields surface in the dispatcher's body builder.
    IF NEW.name IS DISTINCT FROM OLD.name
       OR NEW.start_date IS DISTINCT FROM OLD.start_date
       OR NEW.end_date IS DISTINCT FROM OLD.end_date
       OR NEW.venue_name IS DISTINCT FROM OLD.venue_name
       OR NEW.venue_address IS DISTINCT FROM OLD.venue_address
       OR NEW.venue_city IS DISTINCT FROM OLD.venue_city
       OR NEW.venue_state IS DISTINCT FROM OLD.venue_state
       OR NEW.booth_number IS DISTINCT FROM OLD.booth_number
       OR NEW.notes IS DISTINCT FROM OLD.notes
       OR NEW.organizing_body IS DISTINCT FROM OLD.organizing_body
       OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
    THEN
      INSERT INTO public.trade_show_gcal_sync_queue (trade_show_id, action)
      VALUES (NEW.id, 'sync');
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    SELECT calendar_id, google_calendar_event_id INTO v_link
      FROM public.trade_show_gcal_event_links
     WHERE trade_show_id = OLD.id;
    IF v_link.google_calendar_event_id IS NOT NULL THEN
      INSERT INTO public.trade_show_gcal_sync_queue (trade_show_id, action, snapshot)
      VALUES (
        OLD.id,
        'delete',
        jsonb_build_object(
          'calendar_id', v_link.calendar_id,
          'google_event_id', v_link.google_calendar_event_id
        )
      );
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_trade_show_gcal_sync ON public.trade_shows;
CREATE TRIGGER trg_trade_show_gcal_sync
AFTER INSERT OR UPDATE OR DELETE ON public.trade_shows
FOR EACH ROW EXECUTE FUNCTION public.enqueue_trade_show_gcal_sync();

-- ── 5. Claim RPC ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_due_trade_show_syncs(batch_size INT DEFAULT 25)
RETURNS SETOF public.trade_show_gcal_sync_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT id FROM public.trade_show_gcal_sync_queue
    WHERE status = 'pending'
      AND scheduled_for <= now()
    ORDER BY scheduled_for ASC
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.trade_show_gcal_sync_queue q
     SET status = 'processing',
         attempts = attempts + 1,
         updated_at = now()
    FROM due
   WHERE q.id = due.id
   RETURNING q.*;
END;
$$;

COMMENT ON FUNCTION public.claim_due_trade_show_syncs(INT) IS
  'Atomically claim up to N pending trade_show_gcal_sync_queue rows. SECURITY DEFINER + SKIP LOCKED so concurrent cron firings never double-claim.';

-- ── 6. Backfill: enqueue every existing live trade show so the
--      cron mirrors them into the (newly-set) calendar.
INSERT INTO public.trade_show_gcal_sync_queue (trade_show_id, action)
SELECT id, 'sync'
  FROM public.trade_shows
 WHERE deleted_at IS NULL;

DO $$
DECLARE
  v_queue INT;
BEGIN
  SELECT COUNT(*) INTO v_queue
    FROM public.trade_show_gcal_sync_queue
   WHERE status = 'pending';
  RAISE NOTICE 'Trade-show GCal scaffold installed. % rows in the queue ready for the cron to drain (will skip-noop until Settings → Trade Show GCal has a calendar_id).', v_queue;
END $$;
