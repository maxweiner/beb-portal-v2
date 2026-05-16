-- ============================================================
-- Shipping portal: no-hold stores visible + backfill old events
--
-- Two changes:
--
-- 1. No-hold stores were silently SKIPPED by the create_event_shipment
--    trigger (the `IF v_hold IS NULL THEN RETURN NEW` early-return).
--    Per spec 2026-05-15: no-hold stores still ship — just
--    immediately after the event ends — so they need a shipment row
--    too. We use start_date + 3 days as the ship_date for no-hold,
--    matching the typical event length (the day after the 3-day
--    event ends).
--
-- 2. Events created before the trigger existed have no shipment row
--    AT ALL. Backfill inserts one for every non-cancelled event that
--    doesn't already have one — both held stores AND no-hold stores.
--    Uses the same ship-date math as the trigger.
--
-- After this runs:
--   - Sami May event (no-hold) appears in the shipping portal with
--     ship_date = event start + 3 days.
--   - Every historical event with a valid store gets a backfilled
--     shipment row.
--   - Going forward, the trigger fires for new events of ANY hold
--     setting.
--
-- Safe to re-run. Idempotent (ON CONFLICT (event_id) DO NOTHING on
-- the backfill; trigger ALREADY had ON CONFLICT).
-- ============================================================

-- 1. Replace the create trigger so it handles no-hold stores too.
CREATE OR REPLACE FUNCTION create_event_shipment()
RETURNS TRIGGER AS $$
DECLARE
  v_hold INT;
  v_jcount INT;
  v_scount INT;
  v_ship_date DATE;
BEGIN
  SELECT hold_time_days, default_jewelry_box_count, default_silver_box_count
    INTO v_hold, v_jcount, v_scount
  FROM stores
  WHERE id = NEW.store_id;

  -- No-hold stores: ship immediately after the event ends.
  -- Held stores: ship hold_time_days after event start.
  -- 3-day event default — start + 3 = day after event ends.
  IF v_hold IS NULL THEN
    v_ship_date := NEW.start_date + INTERVAL '3 days';
  ELSE
    v_ship_date := NEW.start_date + (v_hold || ' days')::INTERVAL;
  END IF;

  INSERT INTO event_shipments (event_id, store_id, ship_date, jewelry_box_count, silver_box_count)
  VALUES (
    NEW.id,
    NEW.store_id,
    v_ship_date,
    COALESCE(v_jcount, 5),
    COALESCE(v_scount, 3)
  )
  ON CONFLICT (event_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger binding doesn't change. CREATE OR REPLACE FUNCTION above
-- swaps the body atomically; existing trg_create_event_shipment
-- starts using the new logic on the next insert.

-- 2. Resync trigger — same no-hold awareness for when an event's
--    start_date is later edited.
CREATE OR REPLACE FUNCTION resync_event_shipment_date()
RETURNS TRIGGER AS $$
DECLARE
  v_hold INT;
  v_ship_date DATE;
BEGIN
  IF NEW.start_date IS NOT DISTINCT FROM OLD.start_date THEN
    RETURN NEW;
  END IF;
  SELECT hold_time_days INTO v_hold FROM stores WHERE id = NEW.store_id;

  IF v_hold IS NULL THEN
    v_ship_date := NEW.start_date + INTERVAL '3 days';
  ELSE
    v_ship_date := NEW.start_date + (v_hold || ' days')::INTERVAL;
  END IF;

  UPDATE event_shipments
     SET ship_date = v_ship_date
   WHERE event_id = NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Backfill — every non-cancelled event without a shipment row.
INSERT INTO event_shipments (event_id, store_id, ship_date, jewelry_box_count, silver_box_count)
SELECT
  e.id,
  e.store_id,
  CASE
    WHEN s.hold_time_days IS NULL THEN (e.start_date + INTERVAL '3 days')::date
    ELSE (e.start_date + (s.hold_time_days || ' days')::INTERVAL)::date
  END AS ship_date,
  COALESCE(s.default_jewelry_box_count, 5),
  COALESCE(s.default_silver_box_count, 3)
FROM events e
JOIN stores s ON s.id = e.store_id
WHERE e.start_date IS NOT NULL
  AND COALESCE(e.status, 'scheduled') <> 'cancelled'
  AND NOT EXISTS (
    SELECT 1 FROM event_shipments es WHERE es.event_id = e.id
  );

DO $$
DECLARE
  v_total INT;
  v_no_hold INT;
BEGIN
  SELECT COUNT(*) INTO v_total FROM event_shipments;
  SELECT COUNT(*) INTO v_no_hold
    FROM event_shipments es
    JOIN stores s ON s.id = es.store_id
   WHERE s.hold_time_days IS NULL;
  RAISE NOTICE 'Shipping backfill done. Total shipments: %. No-hold-store shipments: %.', v_total, v_no_hold;
END $$;
