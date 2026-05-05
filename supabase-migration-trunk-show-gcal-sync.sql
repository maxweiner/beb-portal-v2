-- ── Trunk-show Google Calendar sync ──────────────────────────
-- PR C of the per-rep trunk-show calendar feature.
--
-- Each trunk show is mirrored as an event on the assigned rep's
-- personal Google Calendar (created via PR B). Reassigning the
-- show moves the event from the old rep's calendar to the new
-- rep's calendar. Cancelling or soft-deleting removes it.
--
-- Architecture mirrors gcal_sync_queue (used for buying events):
-- trigger enqueues mutations, a Vercel cron drains the queue and
-- dispatches Google API calls.
--
-- Safe to re-run.
-- ============================================================

-- ── 1. Per-trunk-show event link (which calendar / which event) ──
CREATE TABLE IF NOT EXISTS public.trunk_show_gcal_event_links (
  trunk_show_id UUID PRIMARY KEY REFERENCES public.trunk_shows(id) ON DELETE CASCADE,
  -- Which rep's calendar the event currently lives on. We need
  -- this so reassignment knows where to delete from. RESTRICT
  -- because deleting a rep with live trunk shows is dangerous.
  rep_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  calendar_id TEXT NOT NULL,
  google_calendar_event_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trunk_show_gcal_links_rep
  ON public.trunk_show_gcal_event_links (rep_user_id);

ALTER TABLE public.trunk_show_gcal_event_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read trunk_show_gcal_event_links" ON public.trunk_show_gcal_event_links;
CREATE POLICY "Admins read trunk_show_gcal_event_links"
  ON public.trunk_show_gcal_event_links FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.email = auth.jwt()->>'email' AND u.role IN ('admin','superadmin')
  ));

-- ── 2. Sync queue ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trunk_show_gcal_sync_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trunk_show_id UUID,                  -- NULL allowed: deletes can outlive the row
  -- 'sync' = dispatcher figures out create/update/reassign from current state.
  -- 'delete' = explicit removal using the captured snapshot below.
  action TEXT NOT NULL CHECK (action IN ('sync','delete')),
  -- For deletes, snapshot of where the Google event lived at the
  -- moment of trigger fire. JSON shape: { rep_user_id, calendar_id, google_event_id }.
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

CREATE INDEX IF NOT EXISTS idx_trunk_gcal_queue_due
  ON public.trunk_show_gcal_sync_queue (scheduled_for) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_trunk_gcal_queue_show
  ON public.trunk_show_gcal_sync_queue (trunk_show_id);
CREATE INDEX IF NOT EXISTS idx_trunk_gcal_queue_status
  ON public.trunk_show_gcal_sync_queue (status, created_at DESC);

ALTER TABLE public.trunk_show_gcal_sync_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read trunk_show_gcal_sync_queue" ON public.trunk_show_gcal_sync_queue;
CREATE POLICY "Admins read trunk_show_gcal_sync_queue"
  ON public.trunk_show_gcal_sync_queue FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.email = auth.jwt()->>'email' AND u.role IN ('admin','superadmin')
  ));

-- ── 3. Trigger: enqueue sync rows on every trunk_shows mutation ──
-- INSERT: enqueue 'sync' (dispatcher will skip if no rep / no calendar).
-- UPDATE: enqueue 'sync' if any sync-relevant field changed
--         (assigned_rep_id, start_date, end_date, store_id, status,
--         vip_showing, notes, deleted_at). Dispatcher handles
--         reassignment + soft-delete-via-deleted_at.
-- DELETE: capture the link snapshot up front, enqueue 'delete'.
CREATE OR REPLACE FUNCTION public.enqueue_trunk_show_gcal_sync()
RETURNS TRIGGER AS $$
DECLARE
  v_link RECORD;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.trunk_show_gcal_sync_queue (trunk_show_id, action)
    VALUES (NEW.id, 'sync');

  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.assigned_rep_id IS DISTINCT FROM OLD.assigned_rep_id
       OR NEW.start_date IS DISTINCT FROM OLD.start_date
       OR NEW.end_date IS DISTINCT FROM OLD.end_date
       OR NEW.store_id IS DISTINCT FROM OLD.store_id
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.vip_showing IS DISTINCT FROM OLD.vip_showing
       OR NEW.notes IS DISTINCT FROM OLD.notes
       OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
    THEN
      INSERT INTO public.trunk_show_gcal_sync_queue (trunk_show_id, action)
      VALUES (NEW.id, 'sync');
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    SELECT rep_user_id, calendar_id, google_calendar_event_id
      INTO v_link
      FROM public.trunk_show_gcal_event_links
      WHERE trunk_show_id = OLD.id;
    IF FOUND THEN
      INSERT INTO public.trunk_show_gcal_sync_queue (trunk_show_id, action, snapshot)
      VALUES (OLD.id, 'delete', jsonb_build_object(
        'rep_user_id', v_link.rep_user_id,
        'calendar_id', v_link.calendar_id,
        'google_event_id', v_link.google_calendar_event_id
      ));
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_trunk_shows_gcal_sync ON public.trunk_shows;
CREATE TRIGGER trg_trunk_shows_gcal_sync
AFTER INSERT OR UPDATE OR DELETE ON public.trunk_shows
FOR EACH ROW EXECUTE FUNCTION public.enqueue_trunk_show_gcal_sync();

-- ── 4. RPC: claim due rows atomically (mirrors gcal_sync pattern) ──
CREATE OR REPLACE FUNCTION public.claim_due_trunk_show_syncs(batch_size INT DEFAULT 25)
RETURNS SETOF public.trunk_show_gcal_sync_queue
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT id FROM public.trunk_show_gcal_sync_queue
    WHERE status = 'pending' AND scheduled_for <= now()
    ORDER BY scheduled_for ASC
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.trunk_show_gcal_sync_queue q
  SET status = 'processing', updated_at = now()
  FROM due
  WHERE q.id = due.id
  RETURNING q.*;
END;
$$;

DO $$ BEGIN
  RAISE NOTICE 'Trunk-show GCal sync infra installed: links table, queue, trigger, claim RPC.';
END $$;
