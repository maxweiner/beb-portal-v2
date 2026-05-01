-- ============================================================
-- Customers module — PHASE 5: customer_events audit + tier-change trigger
--
-- Drives the per-customer timeline view. Events come from three
-- sources today:
--   1. App writes (this table — note adds, tag changes, edits,
--      created, imported)
--   2. customer_mailings (already exists — Phase 1)
--   3. appointments (already exists — joined by email/phone snapshot
--      since appointments don't have a customer_id FK yet; Phase 12
--      backfills + adds the FK)
--
-- Only ONE new table here. The timeline reader merges these three
-- sources at read time — no denormalization or pre-computed view.
--
-- Tier changes get logged automatically by a BEFORE UPDATE trigger.
-- Other event types are logged from the API / UI layer via a small
-- lib/customers/events.ts helper.
--
-- Safe to re-run.
-- ============================================================

DO $$ BEGIN
  CREATE TYPE customer_event_type AS ENUM (
    'created',       -- new customer row (manual entry or import)
    'imported',      -- merged into an existing record by the import dedup matcher
    'edited',        -- CustomerDetail save with any non-tag field change
    'note_added',    -- notes field gained content / changed
    'tag_added',
    'tag_removed',
    'tier_changed',  -- engagement_tier transitioned (cron or manual recompute)
    'merged'         -- dedup-review merge action collapsed an incoming row in
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS customer_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  event_type  customer_event_type NOT NULL,
  actor_id    UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  description TEXT NULL,
  meta        JSONB NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customer_events_customer ON customer_events(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_events_created  ON customer_events(created_at);
CREATE INDEX IF NOT EXISTS idx_customer_events_type     ON customer_events(event_type);

COMMENT ON TABLE customer_events IS
  'Per-customer activity log driving the timeline view. Append-only from the app; the tier_changed event_type is auto-logged via trg_customers_log_tier_change.';

-- ── Tier-change trigger ────────────────────────────────────
-- Fires only when engagement_tier actually changes (UPDATE WHERE
-- engagement_tier IS DISTINCT FROM ... is the cheap path the cron
-- already takes, so this trigger only fires for real transitions).
CREATE OR REPLACE FUNCTION customers_log_tier_change() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.engagement_tier IS DISTINCT FROM OLD.engagement_tier THEN
    INSERT INTO customer_events (customer_id, event_type, actor_id, description, meta)
    VALUES (
      NEW.id,
      'tier_changed',
      NULL,  -- cron / RPC has no auth.uid(); manual recompute also routes through service role
      format('Tier changed from %s to %s',
        coalesce(OLD.engagement_tier::text, 'none'),
        coalesce(NEW.engagement_tier::text, 'none')),
      jsonb_build_object('from', OLD.engagement_tier, 'to', NEW.engagement_tier)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_customers_log_tier_change ON customers;
CREATE TRIGGER trg_customers_log_tier_change
  AFTER UPDATE OF engagement_tier ON customers
  FOR EACH ROW
  EXECUTE FUNCTION customers_log_tier_change();

-- ── RLS ────────────────────────────────────────────────────
-- Same shape as customer_tags / customer_mailings: visible to admin
-- always; visible to a buyer when they have access to the parent
-- customer's store. Writes are admin-only at the table level (the
-- app-side helper uses service role through API routes; tier changes
-- come from the trigger).
ALTER TABLE customer_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_events_select ON customer_events;
CREATE POLICY customer_events_select ON customer_events
  FOR SELECT USING (
    customers_actor_is_admin()
    OR EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = customer_events.customer_id
         AND c.deleted_at IS NULL
         AND customers_buyer_has_event_access(c.store_id)
    )
  );

DROP POLICY IF EXISTS customer_events_write_admin ON customer_events;
CREATE POLICY customer_events_write_admin ON customer_events
  FOR ALL USING (customers_actor_is_admin())
  WITH CHECK (customers_actor_is_admin());

DO $$ BEGIN
  RAISE NOTICE 'customer_events table + tier-change trigger installed.';
END $$;
