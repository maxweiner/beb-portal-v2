-- ============================================================
-- Shipping Module — Manifest Photo Upload (Phase 1)
--
-- Per-box manifest photos (the handwritten/printed list of lots
-- packed in each J or S box). Mobile-first: buyer snaps a photo of
-- the manifest with their phone after packing. Multiple photos per
-- box (manifest may span pages, plus the user may capture the box
-- label).
--
-- Storage:
--   Private bucket `manifests`. Files at
--     {shipment_id}/{box_id}/{uuid}.jpg
--   Server routes do the upload via service role; signed URLs for
--   read. Same posture as expense-receipts.
--
-- Soft delete: 30-day undo window via deleted_at, mirroring the
-- todo + expense patterns. Hard purge cron lands in a follow-up.
--
-- Safe to re-run.
-- ============================================================

-- ── 1. Table ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shipping_manifests (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  box_id          uuid        NOT NULL REFERENCES event_shipment_boxes(id) ON DELETE CASCADE,
  file_path       text        NOT NULL,                  -- e.g. {shipment_id}/{box_id}/{uuid}.jpg
  file_size_bytes integer     NOT NULL CHECK (file_size_bytes >= 0),
  is_scan_style   boolean     NOT NULL DEFAULT true,     -- true = grayscale + contrast; false = original color
  uploaded_by     uuid        NULL REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz NULL                       -- soft-delete; NULL = live
);

CREATE INDEX IF NOT EXISTS idx_shipping_manifests_box
  ON shipping_manifests (box_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_shipping_manifests_deleted_at
  ON shipping_manifests (deleted_at);

-- ── 2. RLS ───────────────────────────────────────────────────

ALTER TABLE shipping_manifests ENABLE ROW LEVEL SECURITY;

-- Read: any buyer/admin/superadmin (matches event_shipment_boxes.read).
DROP POLICY IF EXISTS shipping_manifests_read ON shipping_manifests;
CREATE POLICY shipping_manifests_read ON shipping_manifests FOR SELECT TO public
  USING (get_my_role() IN ('buyer','admin','superadmin'));

-- Insert / update / delete: admins/superadmins anywhere; workers only
-- on boxes whose parent event has them in events.workers (mirrors
-- event_shipment_boxes.boxes_manage).
DROP POLICY IF EXISTS shipping_manifests_insert ON shipping_manifests;
CREATE POLICY shipping_manifests_insert ON shipping_manifests FOR INSERT TO public
  WITH CHECK (
    get_my_role() IN ('admin','superadmin')
    OR EXISTS (
      SELECT 1
      FROM event_shipment_boxes b
      JOIN event_shipments       s ON s.id = b.shipment_id
      JOIN events                e ON e.id = s.event_id
      WHERE b.id = shipping_manifests.box_id
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(e.workers, '[]'::jsonb)) w
          WHERE (w->>'id')::uuid = (
            SELECT id FROM users u
            WHERE u.email = auth.jwt()->>'email' LIMIT 1
          )
        )
    )
  );

DROP POLICY IF EXISTS shipping_manifests_update ON shipping_manifests;
CREATE POLICY shipping_manifests_update ON shipping_manifests FOR UPDATE TO public
  USING (
    get_my_role() IN ('admin','superadmin')
    OR EXISTS (
      SELECT 1
      FROM event_shipment_boxes b
      JOIN event_shipments       s ON s.id = b.shipment_id
      JOIN events                e ON e.id = s.event_id
      WHERE b.id = shipping_manifests.box_id
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(e.workers, '[]'::jsonb)) w
          WHERE (w->>'id')::uuid = (
            SELECT id FROM users u
            WHERE u.email = auth.jwt()->>'email' LIMIT 1
          )
        )
    )
  );

-- No DELETE policy — soft-delete via UPDATE only. The 30-day cron
-- (lands later) hard-deletes via the service role.

-- ── 3. Storage bucket ────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('manifests', 'manifests', false)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  RAISE NOTICE 'shipping_manifests table + manifests bucket installed.';
END $$;
