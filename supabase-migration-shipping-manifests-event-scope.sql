-- ============================================================
-- Shipping manifests — re-key from box to event.
--
-- Phase 1 attached manifests to event_shipment_boxes (one record
-- per J/S box). User feedback: the manifest is created during the
-- event itself, before any shipping decisions, and "no-hold" stores
-- never get a shipment row at all. Re-keying to event_id so every
-- event supports the feature.
--
-- box_id stays as a nullable column for now; future per-box pinning
-- can use it without a re-migration. event_id becomes the
-- authoritative scope for both queries and policies.
--
-- Safe to re-run.
-- ============================================================

-- ── 1. Add event_id ──────────────────────────────────────────
ALTER TABLE shipping_manifests
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES events(id) ON DELETE CASCADE;

-- Backfill any rows that arrived via the old box-scope path.
UPDATE shipping_manifests m
   SET event_id = s.event_id
  FROM event_shipment_boxes b
  JOIN event_shipments s ON s.id = b.shipment_id
 WHERE m.box_id = b.id
   AND m.event_id IS NULL;

-- Going forward every row needs an event_id.
ALTER TABLE shipping_manifests
  ALTER COLUMN event_id SET NOT NULL;

-- box_id is now optional (kept for future per-box pinning).
ALTER TABLE shipping_manifests
  ALTER COLUMN box_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shipping_manifests_event
  ON shipping_manifests (event_id) WHERE deleted_at IS NULL;

-- ── 2. RLS policies — switch from box-membership to event-membership
DROP POLICY IF EXISTS shipping_manifests_insert ON shipping_manifests;
CREATE POLICY shipping_manifests_insert ON shipping_manifests FOR INSERT TO public
  WITH CHECK (
    get_my_role() IN ('admin','superadmin')
    OR EXISTS (
      SELECT 1
      FROM events e
      WHERE e.id = shipping_manifests.event_id
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
      FROM events e
      WHERE e.id = shipping_manifests.event_id
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

-- read policy unchanged: any authenticated buyer/admin/superadmin

DO $$ BEGIN
  RAISE NOTICE 'shipping_manifests re-keyed to event_id. box_id retained nullable.';
END $$;
