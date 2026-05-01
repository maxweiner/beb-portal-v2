-- ============================================================
-- Customers module — PHASE 4: engagement-scoring SQL function
--
-- Recomputes engagement_tier for every non-deleted customer.
-- Single SQL pass — only touches rows where the tier actually
-- changes, so updated_at doesn't churn for unchanged rows.
--
-- Tier logic (per spec):
--   vip:    vip_override = true OR lifetime_appointment_count >= vip_threshold
--   cold:   last_appointment_date NULL OR > lapsed_days ago
--   lapsed: last_appointment_date > active_days ago (and < lapsed_days)
--   active: appointment within active_days
--
-- Thresholds default to 365 / 730 / 5 but the cron route + admin UI
-- read overrides from the `settings` table at keys:
--   customers.engagement.active_days
--   customers.engagement.lapsed_days
--   customers.engagement.vip_threshold
--
-- Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION customers_recompute_engagement(
  p_active_days   INTEGER DEFAULT 365,
  p_lapsed_days   INTEGER DEFAULT 730,
  p_vip_threshold INTEGER DEFAULT 5
) RETURNS INTEGER AS $$
DECLARE
  rows_updated INTEGER;
BEGIN
  WITH new_tiers AS (
    SELECT
      c.id,
      CASE
        WHEN c.vip_override OR c.lifetime_appointment_count >= p_vip_threshold
          THEN 'vip'::customer_engagement_tier
        WHEN c.last_appointment_date IS NULL
          OR c.last_appointment_date < (CURRENT_DATE - p_lapsed_days)
          THEN 'cold'::customer_engagement_tier
        WHEN c.last_appointment_date < (CURRENT_DATE - p_active_days)
          THEN 'lapsed'::customer_engagement_tier
        ELSE 'active'::customer_engagement_tier
      END AS new_tier
    FROM customers c
    WHERE c.deleted_at IS NULL
  )
  UPDATE customers c
     SET engagement_tier = n.new_tier
    FROM new_tiers n
   WHERE c.id = n.id
     AND c.engagement_tier IS DISTINCT FROM n.new_tier;
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RETURN rows_updated;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION customers_recompute_engagement IS
  'Recomputes customers.engagement_tier in a single pass. Only writes to rows whose tier actually changes (so updated_at doesn''t churn). Returns the number of rows updated. Called by /api/cron/customers-engagement nightly and by the admin "Recompute now" button.';

-- Seed default thresholds in the settings table so the admin UI has
-- starting values to render. Uses ON CONFLICT to never overwrite an
-- already-tuned value.
INSERT INTO settings (key, value) VALUES
  ('customers.engagement.active_days',   '365'),
  ('customers.engagement.lapsed_days',   '730'),
  ('customers.engagement.vip_threshold', '5')
ON CONFLICT (key) DO NOTHING;

DO $$ BEGIN
  RAISE NOTICE 'customers_recompute_engagement() installed; defaults seeded.';
END $$;
