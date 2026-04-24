-- ============================================================
-- Store-level booking configuration for the appointment system
-- Run this in Supabase SQL Editor BEFORE supabase-migration-appointments.sql
--
-- Adds:
--   - stores.slug, stores.color_primary, stores.color_secondary
--   - booking_config (per-store hours, slot interval, dropdown options, hot-show settings)
--   - appointment_employees (spiff tracking roster — namespaced to avoid collision
--     with a pre-existing `store_employees` table in this database)
--   - store_portal_tokens (token-auth for the shared store-portal link)
-- ============================================================

-- 1. Extend stores with slug + brand colors
-- (booking page contact info reuses existing stores.owner_phone / owner_email
--  and store_image_url for logo — see docs/appointments-spec.md §15.4)
ALTER TABLE stores ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS color_primary TEXT;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS color_secondary TEXT;

-- Unique slug for /book/{slug} URLs (allows multiple NULLs while we backfill)
CREATE UNIQUE INDEX IF NOT EXISTS idx_stores_slug_unique
  ON stores(slug)
  WHERE slug IS NOT NULL;

-- 2. booking_config: one row per store
CREATE TABLE IF NOT EXISTS booking_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL UNIQUE REFERENCES stores(id) ON DELETE CASCADE,

  -- Slot definition
  slot_interval_minutes INT NOT NULL DEFAULT 20,
  max_concurrent_slots INT NOT NULL DEFAULT 3,

  -- Default hours per event day (null = day not offered by default)
  day1_start TIME,
  day1_end   TIME,
  day2_start TIME,
  day2_end   TIME,
  day3_start TIME,
  day3_end   TIME,

  -- Customer-facing dropdown options
  items_options JSONB NOT NULL DEFAULT
    '["Gold","Diamonds","Watches","Coins","Jewelry","I''m Not Sure"]'::jsonb,
  hear_about_options JSONB NOT NULL DEFAULT
    '["Large Postcard","Small Postcard","Newspaper","Email","Text","The Store Told Me"]'::jsonb,

  -- Hot-show alert
  hot_show_threshold INT NOT NULL DEFAULT 80,
  hot_show_notify_sms BOOLEAN NOT NULL DEFAULT true,
  hot_show_notify_email BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_config_store ON booking_config(store_id);

-- 3. appointment_employees: spiff roster (admin-managed)
-- Namespaced to avoid collision with the pre-existing public.store_employees
-- (id, store_id, name, phone, email, created_at), which serves a different purpose.
CREATE TABLE IF NOT EXISTS appointment_employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appointment_employees_store
  ON appointment_employees(store_id);
CREATE INDEX IF NOT EXISTS idx_appointment_employees_active
  ON appointment_employees(store_id) WHERE active = true;

-- 4. store_portal_tokens: shared per-store auth for the store portal page
CREATE TABLE IF NOT EXISTS store_portal_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_store_portal_tokens_store ON store_portal_tokens(store_id);

-- 5. RLS — admin/superadmin only via authenticated session.
--    Customer booking + store portal go through API routes that use the
--    service role key, which bypasses RLS.
ALTER TABLE booking_config         ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_employees  ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_portal_tokens    ENABLE ROW LEVEL SECURITY;

-- booking_config policies
CREATE POLICY "Admins manage booking_config"
  ON booking_config FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.email = auth.jwt()->>'email'
        AND u.role IN ('admin', 'superadmin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.email = auth.jwt()->>'email'
        AND u.role IN ('admin', 'superadmin')
    )
  );

-- appointment_employees policies
CREATE POLICY "Admins manage appointment_employees"
  ON appointment_employees FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.email = auth.jwt()->>'email'
        AND u.role IN ('admin', 'superadmin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.email = auth.jwt()->>'email'
        AND u.role IN ('admin', 'superadmin')
    )
  );

-- store_portal_tokens policies
CREATE POLICY "Admins manage store_portal_tokens"
  ON store_portal_tokens FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.email = auth.jwt()->>'email'
        AND u.role IN ('admin', 'superadmin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.email = auth.jwt()->>'email'
        AND u.role IN ('admin', 'superadmin')
    )
  );

-- 6. Auto-touch updated_at on booking_config
CREATE OR REPLACE FUNCTION touch_booking_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_booking_config_updated_at ON booking_config;
CREATE TRIGGER trg_booking_config_updated_at
  BEFORE UPDATE ON booking_config
  FOR EACH ROW EXECUTE FUNCTION touch_booking_config_updated_at();
