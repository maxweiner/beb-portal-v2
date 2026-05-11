-- ============================================================
-- Ad-hoc Google Calendar events
--
-- Lets a superadmin add one-off events to either the brand-level
-- Beneficial buying-events calendar or a specific trunk-rep's
-- personal calendar. CRUD on the portal mirrors to Google — create
-- pushes to Google, edits patch the Google event, delete removes
-- it from Google. The portal row is the canonical record.
--
-- Distinct from buying events (which live in `events`, sync via a
-- trigger + queue + dispatcher) and from trunk shows. Ad-hoc events
-- have no business semantics — they're just direct calendar entries.
--
-- Safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.gcal_adhoc_events (
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  title                    TEXT         NOT NULL,
  start_date               DATE         NOT NULL,
  /** All-day event end. NULL means single-day. Stored inclusive on
   *  the portal side; the API translates to Google's exclusive
   *  end-date semantics at push time. */
  end_date                 DATE,
  description              TEXT,
  location                 TEXT,
  /** Google Calendar id we push to. Either the BEB brand calendar
   *  (from gcal_integration_settings.calendar_id) or a trunk rep's
   *  personal calendar (from users.trunk_show_calendar_id). */
  target_calendar_id       TEXT         NOT NULL,
  /** Human-readable target label denormalised for list display so
   *  we don't have to join across two unrelated tables on every
   *  render. e.g. "BEB buying events" or "Ann's trunk shows". */
  target_label             TEXT         NOT NULL,
  /** Google's id for the pushed event. Always set after a
   *  successful create. Used to PATCH / DELETE on later edits. */
  google_calendar_event_id TEXT,
  created_by               UUID         REFERENCES public.users(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gcal_adhoc_events_start_idx
  ON public.gcal_adhoc_events (start_date);

ALTER TABLE public.gcal_adhoc_events ENABLE ROW LEVEL SECURITY;

-- Read: superadmin only (the feature is gated to them in the UI and
-- the API; mirror the gate in RLS so a stray client query can't
-- exfiltrate ad-hoc rows).
DROP POLICY IF EXISTS gcal_adhoc_events_read ON public.gcal_adhoc_events;
CREATE POLICY gcal_adhoc_events_read ON public.gcal_adhoc_events
  FOR SELECT TO authenticated
  USING (public.get_my_role() = 'superadmin');

-- Write: superadmin only. All actual writes go through the API,
-- which authenticates via the Bearer-token pattern and then uses
-- the service role for the Supabase insert/update/delete — but we
-- still want RLS to block any direct client write.
DROP POLICY IF EXISTS gcal_adhoc_events_write ON public.gcal_adhoc_events;
CREATE POLICY gcal_adhoc_events_write ON public.gcal_adhoc_events
  FOR ALL TO authenticated
  USING (public.get_my_role() = 'superadmin')
  WITH CHECK (public.get_my_role() = 'superadmin');

DO $$ BEGIN
  RAISE NOTICE 'Created gcal_adhoc_events. Superadmin-only RLS in place.';
END $$;
