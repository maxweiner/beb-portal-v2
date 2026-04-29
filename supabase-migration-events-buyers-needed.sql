-- ============================================================
-- events: buyers_needed
--
-- Per-event staffing requirement. Drives the ⚠ Understaffed hazard
-- shown on event cards, dashboard tiles, and calendar chips when
-- assigned worker count < buyers_needed.
--
-- Nullable for backwards compatibility (new events validate at the
-- form level; legacy null rows render no hazard). CHECK constraint
-- bounds 1..20.
--
-- Backfill: every existing event gets buyers_needed = 3 per
-- partner direction.
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS buyers_needed INT
    CHECK (buyers_needed IS NULL OR (buyers_needed >= 1 AND buyers_needed <= 20));

COMMENT ON COLUMN events.buyers_needed
  IS 'How many buyers should staff this event. NULL = not specified (no hazard). Form-level required on new events.';

-- Backfill: all existing events default to 3.
UPDATE events SET buyers_needed = 3 WHERE buyers_needed IS NULL;

DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM events WHERE buyers_needed IS NOT NULL;
  RAISE NOTICE 'buyers_needed installed. Events with a value set: %', n;
END $$;
