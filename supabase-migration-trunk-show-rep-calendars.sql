-- ── Per-rep trunk-show Google calendars ──────────────────────
-- Each sales rep gets their own Google Calendar that we (the
-- service account) own and write trunk-show events to. The rep
-- subscribes from their personal Google account via a public
-- read-only URL, which lets them turn other reps' calendars on
-- and off in their own Google Calendar UI.
--
-- This migration only adds the storage columns. PR B introduces
-- the endpoint that actually creates the calendar in Google,
-- grants ACL, and populates these fields.
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS trunk_show_calendar_id TEXT,
  ADD COLUMN IF NOT EXISTS trunk_show_calendar_subscribe_url TEXT;

COMMENT ON COLUMN public.users.trunk_show_calendar_id IS
  'Google Calendar ID for this rep''s personal trunk-show calendar. Owned by our service account; rep subscribes via the public URL.';

COMMENT ON COLUMN public.users.trunk_show_calendar_subscribe_url IS
  'Public webcal:// URL the rep adds to their personal Google / Apple Calendar to subscribe (read-only) to their trunk-show feed. Populated by the create-calendar endpoint in PR B.';

DO $$ BEGIN
  RAISE NOTICE 'users.trunk_show_calendar_id + trunk_show_calendar_subscribe_url installed.';
END $$;
