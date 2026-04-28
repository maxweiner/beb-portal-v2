-- ============================================================
-- Store Shipping PR 1: schema + per-store settings.
--
-- Adds:
--   - stores.hold_time_days (NULL = "No Hold")
--   - stores.default_jewelry_box_count, default_silver_box_count
--   - stores.shipping_recipients (TEXT[])
--   - event_shipments — one row per event (auto-created via trigger)
--   - event_shipment_boxes — one row per box (spawned at Day 1; PR 2
--     handles the spawn job)
--
-- Hold Time storage: int days (NULL = no shipping flow at all).
-- 7 / 14 / 21 / 30 are the spec's dropdown values; the column
-- itself accepts any positive int so future tweaks are free.
--
-- Box auto-create on event insert is implemented via a Postgres
-- trigger so both UI-initiated and bulk-imported events stay
-- consistent.
--
-- Safe to re-run.
-- ============================================================

-- ── 1. Stores: shipping settings ────────────────────────────
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS hold_time_days INT
    CHECK (hold_time_days IS NULL OR hold_time_days > 0);

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS default_jewelry_box_count INT NOT NULL DEFAULT 5
    CHECK (default_jewelry_box_count >= 0);

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS default_silver_box_count INT NOT NULL DEFAULT 3
    CHECK (default_silver_box_count >= 0);

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS shipping_recipients TEXT[] NOT NULL DEFAULT '{}';

-- New stores default to a 14-day hold per spec (existing rows stay NULL
-- so the user can opt them in deliberately — no surprise calendar
-- entries on yesterday's stores).
ALTER TABLE stores
  ALTER COLUMN hold_time_days SET DEFAULT 14;

-- ── 2. event_shipments ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  ship_date DATE NOT NULL,
  jewelry_box_count INT NOT NULL DEFAULT 0 CHECK (jewelry_box_count >= 0),
  silver_box_count  INT NOT NULL DEFAULT 0 CHECK (silver_box_count  >= 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'complete', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_shipments_store      ON event_shipments(store_id);
CREATE INDEX IF NOT EXISTS idx_event_shipments_ship_date  ON event_shipments(ship_date);
CREATE INDEX IF NOT EXISTS idx_event_shipments_status     ON event_shipments(status);

ALTER TABLE event_shipments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shipments_read   ON event_shipments;
CREATE POLICY shipments_read ON event_shipments FOR SELECT TO public
  USING (get_my_role() IN ('buyer','admin','superadmin'));

DROP POLICY IF EXISTS shipments_manage ON event_shipments;
CREATE POLICY shipments_manage ON event_shipments FOR ALL TO public
  USING (get_my_role() IN ('admin','superadmin'))
  WITH CHECK (get_my_role() IN ('admin','superadmin'));

-- ── 3. event_shipment_boxes ────────────────────────────────
CREATE TABLE IF NOT EXISTS event_shipment_boxes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES event_shipments(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('jewelry','silver')),
  number INT NOT NULL CHECK (number > 0),
  identifier TEXT GENERATED ALWAYS AS
    (CASE type WHEN 'jewelry' THEN 'J' ELSE 'S' END || number::text) STORED,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','labels_sent','shipped','received','cancelled')),
  tracking_number TEXT,
  carrier TEXT CHECK (carrier IS NULL OR carrier IN ('ups','usps','fedex','dhl')),
  notes TEXT,
  labels_sent_at TIMESTAMPTZ,
  shipped_at      TIMESTAMPTZ,
  received_at     TIMESTAMPTZ,
  labels_sent_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  shipped_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  received_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shipment_id, type, number)
);

CREATE INDEX IF NOT EXISTS idx_shipment_boxes_shipment ON event_shipment_boxes(shipment_id);
CREATE INDEX IF NOT EXISTS idx_shipment_boxes_status   ON event_shipment_boxes(status);
CREATE INDEX IF NOT EXISTS idx_shipment_boxes_tracking ON event_shipment_boxes(tracking_number)
  WHERE tracking_number IS NOT NULL;

ALTER TABLE event_shipment_boxes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS boxes_read   ON event_shipment_boxes;
CREATE POLICY boxes_read ON event_shipment_boxes FOR SELECT TO public
  USING (get_my_role() IN ('buyer','admin','superadmin'));

-- Workers assigned to the event, plus admins, can mutate boxes. We
-- check assignment via the events.workers JSONB array (existing pattern).
DROP POLICY IF EXISTS boxes_manage ON event_shipment_boxes;
CREATE POLICY boxes_manage ON event_shipment_boxes FOR ALL TO public
  USING (
    get_my_role() IN ('admin','superadmin')
    OR EXISTS (
      SELECT 1
      FROM event_shipments s
      JOIN events e ON e.id = s.event_id
      JOIN users u  ON u.email = auth.jwt()->>'email'
      WHERE s.id = event_shipment_boxes.shipment_id
        AND e.workers @> jsonb_build_array(jsonb_build_object('id', u.id::text))
    )
  )
  WITH CHECK (
    get_my_role() IN ('admin','superadmin')
    OR EXISTS (
      SELECT 1
      FROM event_shipments s
      JOIN events e ON e.id = s.event_id
      JOIN users u  ON u.email = auth.jwt()->>'email'
      WHERE s.id = event_shipment_boxes.shipment_id
        AND e.workers @> jsonb_build_array(jsonb_build_object('id', u.id::text))
    )
  );

-- ── 4. Trigger: auto-create shipment row on event insert ──
-- Boxes are spawned later (Day 1 of the event window) by PR 2's job.
-- This trigger only sets up the shipment scaffolding so subsequent
-- code always has somewhere to write.

CREATE OR REPLACE FUNCTION create_event_shipment()
RETURNS TRIGGER AS $$
DECLARE
  v_hold INT;
  v_jcount INT;
  v_scount INT;
BEGIN
  SELECT hold_time_days, default_jewelry_box_count, default_silver_box_count
    INTO v_hold, v_jcount, v_scount
  FROM stores
  WHERE id = NEW.store_id;

  -- "No Hold" → no shipment created at all
  IF v_hold IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO event_shipments (event_id, store_id, ship_date, jewelry_box_count, silver_box_count)
  VALUES (
    NEW.id,
    NEW.store_id,
    NEW.start_date + (v_hold || ' days')::INTERVAL,
    COALESCE(v_jcount, 5),
    COALESCE(v_scount, 3)
  )
  ON CONFLICT (event_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_create_event_shipment ON events;
CREATE TRIGGER trg_create_event_shipment
AFTER INSERT ON events
FOR EACH ROW EXECUTE FUNCTION create_event_shipment();

-- ── 5. Trigger: keep ship_date in sync when event start_date moves ──
CREATE OR REPLACE FUNCTION resync_event_shipment_date()
RETURNS TRIGGER AS $$
DECLARE
  v_hold INT;
  v_has_movement BOOLEAN;
BEGIN
  IF NEW.start_date IS NOT DISTINCT FROM OLD.start_date THEN
    RETURN NEW;
  END IF;

  SELECT hold_time_days INTO v_hold FROM stores WHERE id = NEW.store_id;
  IF v_hold IS NULL THEN RETURN NEW; END IF;

  -- Only move ship_date if no boxes have advanced past pending —
  -- per spec ("In-flight events that haven't shipped yet").
  SELECT EXISTS (
    SELECT 1 FROM event_shipment_boxes b
    JOIN event_shipments s ON s.id = b.shipment_id
    WHERE s.event_id = NEW.id AND b.status <> 'pending'
  ) INTO v_has_movement;

  IF v_has_movement THEN RETURN NEW; END IF;

  UPDATE event_shipments
    SET ship_date = NEW.start_date + (v_hold || ' days')::INTERVAL,
        updated_at = now()
    WHERE event_id = NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_resync_event_shipment_date ON events;
CREATE TRIGGER trg_resync_event_shipment_date
AFTER UPDATE OF start_date ON events
FOR EACH ROW EXECUTE FUNCTION resync_event_shipment_date();

-- ── 6. updated_at touch trigger ────────────────────────────
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_event_shipments ON event_shipments;
CREATE TRIGGER trg_touch_event_shipments BEFORE UPDATE ON event_shipments
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_touch_event_shipment_boxes ON event_shipment_boxes;
CREATE TRIGGER trg_touch_event_shipment_boxes BEFORE UPDATE ON event_shipment_boxes
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── 7. Verify ──────────────────────────────────────────────
DO $$
DECLARE shipments_count INT;
BEGIN
  SELECT COUNT(*) INTO shipments_count FROM event_shipments;
  RAISE NOTICE 'Shipping schema installed. event_shipments rows: %', shipments_count;
END $$;
