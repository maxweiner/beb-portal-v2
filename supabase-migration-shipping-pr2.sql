-- ============================================================
-- Store Shipping PR 2: spawn boxes + sync helper.
--
-- PR 1 created the shipment row on event INSERT but left the per-box
-- spawn for later. Now we spawn boxes immediately when a shipment is
-- created and provide a function to resync the box rows when the
-- count is edited (only valid while every box is still 'pending').
--
-- Also backfills any shipments from PR 1 that don't have boxes yet.
--
-- Safe to re-run.
-- ============================================================

-- ── 1. Resync function: drops/adds box rows to match the shipment's counts ──
-- Used by both the spawn trigger and the count-edit code path. Refuses
-- to change a count if any box has advanced past 'pending'.
CREATE OR REPLACE FUNCTION sync_shipment_boxes(p_shipment_id UUID)
RETURNS VOID AS $$
DECLARE
  v_jewelry_target INT;
  v_silver_target  INT;
  v_jewelry_have   INT;
  v_silver_have    INT;
  v_jewelry_movement BOOLEAN;
  v_silver_movement  BOOLEAN;
BEGIN
  SELECT jewelry_box_count, silver_box_count
    INTO v_jewelry_target, v_silver_target
  FROM event_shipments WHERE id = p_shipment_id;

  IF v_jewelry_target IS NULL THEN RETURN; END IF;

  -- Jewelry side
  SELECT COUNT(*), bool_or(status <> 'pending')
    INTO v_jewelry_have, v_jewelry_movement
  FROM event_shipment_boxes
  WHERE shipment_id = p_shipment_id AND type = 'jewelry';

  IF COALESCE(v_jewelry_movement, false) AND v_jewelry_have <> v_jewelry_target THEN
    RAISE EXCEPTION 'Cannot change Jewelry box count after labels are made';
  END IF;

  IF v_jewelry_have < v_jewelry_target THEN
    INSERT INTO event_shipment_boxes (shipment_id, type, number)
    SELECT p_shipment_id, 'jewelry', n
    FROM generate_series(v_jewelry_have + 1, v_jewelry_target) n;
  ELSIF v_jewelry_have > v_jewelry_target THEN
    DELETE FROM event_shipment_boxes
    WHERE shipment_id = p_shipment_id AND type = 'jewelry'
      AND number > v_jewelry_target;
  END IF;

  -- Silver side
  SELECT COUNT(*), bool_or(status <> 'pending')
    INTO v_silver_have, v_silver_movement
  FROM event_shipment_boxes
  WHERE shipment_id = p_shipment_id AND type = 'silver';

  IF COALESCE(v_silver_movement, false) AND v_silver_have <> v_silver_target THEN
    RAISE EXCEPTION 'Cannot change Silver box count after labels are made';
  END IF;

  IF v_silver_have < v_silver_target THEN
    INSERT INTO event_shipment_boxes (shipment_id, type, number)
    SELECT p_shipment_id, 'silver', n
    FROM generate_series(v_silver_have + 1, v_silver_target) n;
  ELSIF v_silver_have > v_silver_target THEN
    DELETE FROM event_shipment_boxes
    WHERE shipment_id = p_shipment_id AND type = 'silver'
      AND number > v_silver_target;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 2. Trigger on event_shipments INSERT: spawn boxes ──
CREATE OR REPLACE FUNCTION spawn_shipment_boxes_trigger()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM sync_shipment_boxes(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_spawn_shipment_boxes ON event_shipments;
CREATE TRIGGER trg_spawn_shipment_boxes
AFTER INSERT ON event_shipments
FOR EACH ROW EXECUTE FUNCTION spawn_shipment_boxes_trigger();

-- ── 3. Trigger on event_shipments UPDATE of box counts: resync ──
CREATE OR REPLACE FUNCTION resync_shipment_boxes_trigger()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.jewelry_box_count IS DISTINCT FROM OLD.jewelry_box_count
     OR NEW.silver_box_count  IS DISTINCT FROM OLD.silver_box_count THEN
    PERFORM sync_shipment_boxes(NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_resync_shipment_boxes ON event_shipments;
CREATE TRIGGER trg_resync_shipment_boxes
AFTER UPDATE OF jewelry_box_count, silver_box_count ON event_shipments
FOR EACH ROW EXECUTE FUNCTION resync_shipment_boxes_trigger();

-- ── 4. Backfill: any PR-1 shipment without boxes gets them now ──
DO $$
DECLARE
  s RECORD;
  spawned INT := 0;
BEGIN
  FOR s IN
    SELECT id FROM event_shipments
    WHERE NOT EXISTS (SELECT 1 FROM event_shipment_boxes b WHERE b.shipment_id = event_shipments.id)
  LOOP
    PERFORM sync_shipment_boxes(s.id);
    spawned := spawned + 1;
  END LOOP;
  RAISE NOTICE 'Spawned boxes for % previously-empty shipment(s).', spawned;
END $$;
