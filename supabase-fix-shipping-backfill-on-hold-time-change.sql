-- ============================================================
-- Fix: events that existed before a store got a Hold Time had no
-- shipment row created (the create_event_shipment trigger only
-- fires on event INSERT). When the user later sets the Hold Time,
-- the existing events need shipments backfilled.
--
-- Per spec:
--   - Past events: never touched.
--   - In-flight / future events with no shipment: create one.
--   - Existing shipments with no box past pending: ship_date
--     recalculates.
--   - Existing shipments with any box past pending: untouched.
--
-- Inclusion rule used here: any event whose computed ship_date is
-- today or in the future. That covers in-flight + future, drops
-- past.
--
-- Safe to re-run.
-- ============================================================

-- ── 1. Trigger function: resync this store's shipments ──
CREATE OR REPLACE FUNCTION resync_store_shipments()
RETURNS TRIGGER AS $$
DECLARE
  ev RECORD;
  has_movement BOOLEAN;
BEGIN
  -- "No Hold" set: leave existing shipments alone (per spec).
  IF NEW.hold_time_days IS NULL THEN RETURN NEW; END IF;

  FOR ev IN
    SELECT id, start_date, store_id
    FROM events
    WHERE store_id = NEW.id
      AND (start_date + (NEW.hold_time_days || ' days')::INTERVAL) >= CURRENT_DATE
  LOOP
    IF NOT EXISTS (SELECT 1 FROM event_shipments s WHERE s.event_id = ev.id) THEN
      -- Missing shipment: create it. The PR 2 INSERT trigger spawns boxes.
      INSERT INTO event_shipments (event_id, store_id, ship_date, jewelry_box_count, silver_box_count)
      VALUES (
        ev.id, ev.store_id,
        (ev.start_date + (NEW.hold_time_days || ' days')::INTERVAL)::DATE,
        COALESCE(NEW.default_jewelry_box_count, 5),
        COALESCE(NEW.default_silver_box_count, 3)
      );
    ELSE
      -- Existing shipment: only move ship_date if no box has moved.
      SELECT EXISTS (
        SELECT 1 FROM event_shipment_boxes b
        JOIN event_shipments s ON s.id = b.shipment_id
        WHERE s.event_id = ev.id AND b.status <> 'pending'
      ) INTO has_movement;

      IF NOT has_movement THEN
        UPDATE event_shipments
          SET ship_date = (ev.start_date + (NEW.hold_time_days || ' days')::INTERVAL)::DATE,
              updated_at = now()
          WHERE event_id = ev.id;
      END IF;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_resync_store_shipments ON stores;
CREATE TRIGGER trg_resync_store_shipments
AFTER UPDATE OF hold_time_days, default_jewelry_box_count, default_silver_box_count ON stores
FOR EACH ROW EXECUTE FUNCTION resync_store_shipments();

-- ── 2. One-time backfill: any store that already has hold_time_days
-- set but has events without shipments. Reuses the same inclusion
-- rule so we don't create stale shipments for old events.
DO $$
DECLARE
  s RECORD;
  ev RECORD;
  created INT := 0;
BEGIN
  FOR s IN SELECT * FROM stores WHERE hold_time_days IS NOT NULL LOOP
    FOR ev IN
      SELECT id, start_date, store_id FROM events e
      WHERE e.store_id = s.id
        AND (e.start_date + (s.hold_time_days || ' days')::INTERVAL) >= CURRENT_DATE
        AND NOT EXISTS (SELECT 1 FROM event_shipments es WHERE es.event_id = e.id)
    LOOP
      INSERT INTO event_shipments (event_id, store_id, ship_date, jewelry_box_count, silver_box_count)
      VALUES (
        ev.id, ev.store_id,
        (ev.start_date + (s.hold_time_days || ' days')::INTERVAL)::DATE,
        COALESCE(s.default_jewelry_box_count, 5),
        COALESCE(s.default_silver_box_count, 3)
      );
      created := created + 1;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'Backfilled % missing shipment(s).', created;
END $$;
