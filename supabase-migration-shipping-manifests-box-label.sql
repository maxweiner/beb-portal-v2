-- ============================================================
-- Shipping manifests — add box_label.
--
-- Each manifest photo covers one physical box. The label (J1, J2,
-- S1, etc.) is handwritten on the box at event time; the carrier
-- shipping label may not exist for 1-2 weeks. We store the buyer's
-- handwritten label as a plain string — no FK to event_shipment_boxes
-- since "no-hold" stores never get those rows.
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE shipping_manifests
  ADD COLUMN IF NOT EXISTS box_label text;

-- Composite index for the common "render this event's manifests
-- grouped by box" query in the viewer.
CREATE INDEX IF NOT EXISTS idx_shipping_manifests_event_box
  ON shipping_manifests (event_id, box_label) WHERE deleted_at IS NULL;

DO $$ BEGIN
  RAISE NOTICE 'shipping_manifests.box_label added.';
END $$;
