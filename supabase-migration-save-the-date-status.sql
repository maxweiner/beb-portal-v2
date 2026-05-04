-- ── Save the Date / Reserved status ───────────────────────────
--
-- Adds a "reserved" status to both trunk shows AND buying events so
-- they can be created in a tentative/planning state, displayed
-- distinctly on the calendar, and promoted to a confirmed booking
-- via an explicit action.
--
-- Status model:
--   trunk_show_status     'reserved' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
--   event_status (NEW)    'reserved' | 'scheduled' | 'cancelled'
--
-- Buying events didn't have a status column at all before this — the
-- mere existence of the row meant "scheduled." We're introducing one
-- now with a default of 'scheduled' so existing rows are unaffected.
-- Hard-deleting an event still works for the "Delete (remove)"
-- option from the cancellation prompt; status='cancelled' supports
-- the "Cancel (keep visible)" option from the same prompt.
--
-- Safe to re-run.
-- ============================================================

-- 1. Trunk shows: extend the existing ENUM.
ALTER TYPE trunk_show_status ADD VALUE IF NOT EXISTS 'reserved' BEFORE 'scheduled';

-- 2. Buying events: introduce a status enum + column.
DO $$ BEGIN
  CREATE TYPE event_status AS ENUM ('reserved', 'scheduled', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS status event_status NOT NULL DEFAULT 'scheduled';

CREATE INDEX IF NOT EXISTS idx_events_status_reserved
  ON public.events (start_date) WHERE status = 'reserved';

COMMENT ON COLUMN public.events.status IS
  'Lifecycle: reserved (Save the Date — not yet confirmed) → scheduled (default; the normal booked state) → cancelled (kept visible with strikethrough). Hard-deletion is also allowed via the Delete action.';

DO $$ BEGIN
  RAISE NOTICE 'Save the Date status installed. trunk_show_status now includes reserved; events.status added with default scheduled.';
END $$;
