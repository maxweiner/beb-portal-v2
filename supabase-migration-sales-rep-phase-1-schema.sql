-- ============================================================
-- Sales Rep + Trade Shows + Trunk Shows — PHASE 1
--   Schema, RLS, role grants, expense_reports column additions.
--
-- Introduces the "selling side" of BEB: sales_rep role,
-- trade_shows + trunk_shows event types, leads pipeline, spiff
-- tracking, and territory-based lead assignment. Walled off from
-- the buying side via RLS — buyers never see sales-side data,
-- sales reps never see buying events / customers.
--
-- Decisions (per chat):
--   • a1: keep expense_reports.event_id; add nullable
--         trunk_show_id + trade_show_id; relax UNIQUE to a
--         partial that only fires on buying events.
--   • b3: per-kind magic-link token tables. Marketing's
--         magic_link_tokens table is untouched.
--   • c1: three new modules (trade-shows, trunk-shows, leads),
--         each grantable independently in Role Manager.
--
-- Safe to re-run.
-- ============================================================


-- ── 1. Helper: is_my_partner() ─────────────────────────────
-- Returns true if the *effective* user (impersonation-aware)
-- has users.is_partner = true. Used in many RLS bodies.
CREATE OR REPLACE FUNCTION public.is_my_partner()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    (SELECT is_partner FROM public.users WHERE id = public.get_effective_user_id()),
    false
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_my_partner() TO authenticated, anon;


-- ── 2. Enums ───────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE trade_show_appointment_status AS ENUM
    ('available', 'booked', 'completed', 'cancelled', 'no_show');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE lead_interest_level AS ENUM ('hot', 'warm', 'cold');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE lead_status AS ENUM ('new', 'contacted', 'converted', 'dead');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE trunk_show_status AS ENUM
    ('scheduled', 'in_progress', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE trunk_show_special_request_status AS ENUM
    ('open', 'acknowledged', 'completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE trunk_show_appointment_status AS ENUM
    ('available', 'booked', 'completed', 'cancelled', 'no_show');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ── 3. New role: sales_rep ─────────────────────────────────
-- The role-management system uses an FK from users.role to
-- roles(id). Add the new role; the Role Manager GUI handles
-- grants from there (also seeded below for parity with other
-- system roles).
INSERT INTO roles (id, label, description, is_system)
VALUES (
  'sales_rep',
  'Sales Rep',
  '1099 sales contractors. Trade shows, trunk shows, leads — selling side only. No buying-event visibility.',
  TRUE
)
ON CONFLICT (id) DO UPDATE
  SET label = EXCLUDED.label,
      description = EXCLUDED.description;


-- ── 4. Extend role_modules CHECK to include new module ids ──
-- The original constraint enumerates valid module ids inline.
-- Drop + recreate with the new entries (trade-shows, trunk-
-- shows, leads, customers — customers was missing despite the
-- module existing, fix that too).
DO $$
DECLARE
  conname text;
BEGIN
  SELECT c.conname INTO conname
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'role_modules' AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%module_id%';
  IF conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE role_modules DROP CONSTRAINT %I', conname);
  END IF;
END $$;

ALTER TABLE role_modules ADD CONSTRAINT role_modules_module_id_check
  CHECK (module_id IN (
    'dashboard', 'calendar', 'events', 'schedule', 'travel',
    'dayentry', 'staff', 'admin', 'libertyadmin', 'stores',
    'data-research', 'reports', 'financials', 'marketing',
    'shipping', 'expenses', 'todo', 'recipients',
    'notification-templates', 'customers',
    'trade-shows', 'trunk-shows', 'leads'
  ));


-- ── 5. booth_cost_categories (admin-managed master list) ───
CREATE TABLE IF NOT EXISTS booth_cost_categories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL UNIQUE,
  is_archived   BOOLEAN NOT NULL DEFAULT FALSE,
  display_order INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_booth_cost_categories_order
  ON booth_cost_categories (is_archived, display_order, name);

ALTER TABLE booth_cost_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS booth_cost_categories_read ON booth_cost_categories;
CREATE POLICY booth_cost_categories_read ON booth_cost_categories
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'superadmin', 'sales_rep')
    OR public.is_my_partner()
  );

DROP POLICY IF EXISTS booth_cost_categories_write ON booth_cost_categories;
CREATE POLICY booth_cost_categories_write ON booth_cost_categories
  FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin', 'superadmin'))
  WITH CHECK (public.get_my_role() IN ('admin', 'superadmin'));


-- ── 6. trade_shows ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trade_shows (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  venue_name        TEXT,
  venue_city        TEXT,
  venue_state       TEXT,
  venue_address     TEXT,
  start_date        DATE NOT NULL,
  end_date          DATE NOT NULL CHECK (end_date >= start_date),
  booth_number      TEXT,
  show_website_url  TEXT,
  organizing_body   TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_trade_shows_dates
  ON trade_shows (start_date) WHERE deleted_at IS NULL;

ALTER TABLE trade_shows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trade_shows_read ON trade_shows;
CREATE POLICY trade_shows_read ON trade_shows
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'superadmin', 'sales_rep')
    OR public.is_my_partner()
  );

DROP POLICY IF EXISTS trade_shows_write ON trade_shows;
CREATE POLICY trade_shows_write ON trade_shows
  FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin', 'superadmin') OR public.is_my_partner())
  WITH CHECK (public.get_my_role() IN ('admin', 'superadmin') OR public.is_my_partner());


-- ── 7. trade_show_staff ────────────────────────────────────
CREATE TABLE IF NOT EXISTS trade_show_staff (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_show_id   UUID NOT NULL REFERENCES trade_shows(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_dates  DATE[] NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (trade_show_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_trade_show_staff_show
  ON trade_show_staff (trade_show_id);
CREATE INDEX IF NOT EXISTS idx_trade_show_staff_user
  ON trade_show_staff (user_id);

ALTER TABLE trade_show_staff ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trade_show_staff_read ON trade_show_staff;
CREATE POLICY trade_show_staff_read ON trade_show_staff
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'superadmin', 'sales_rep')
    OR public.is_my_partner()
  );

DROP POLICY IF EXISTS trade_show_staff_write ON trade_show_staff;
CREATE POLICY trade_show_staff_write ON trade_show_staff
  FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin', 'superadmin') OR public.is_my_partner())
  WITH CHECK (public.get_my_role() IN ('admin', 'superadmin') OR public.is_my_partner());


-- ── 8. trade_show_booth_costs ──────────────────────────────
CREATE TABLE IF NOT EXISTS trade_show_booth_costs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_show_id  UUID NOT NULL REFERENCES trade_shows(id) ON DELETE CASCADE,
  category       TEXT NOT NULL,
  is_custom      BOOLEAN NOT NULL DEFAULT FALSE,
  description    TEXT,
  amount         NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trade_show_booth_costs_show
  ON trade_show_booth_costs (trade_show_id);

ALTER TABLE trade_show_booth_costs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trade_show_booth_costs_read ON trade_show_booth_costs;
CREATE POLICY trade_show_booth_costs_read ON trade_show_booth_costs
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'superadmin', 'sales_rep')
    OR public.is_my_partner()
  );

DROP POLICY IF EXISTS trade_show_booth_costs_write ON trade_show_booth_costs;
CREATE POLICY trade_show_booth_costs_write ON trade_show_booth_costs
  FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin', 'superadmin') OR public.is_my_partner())
  WITH CHECK (public.get_my_role() IN ('admin', 'superadmin') OR public.is_my_partner());


-- ── 9. leads ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name                  TEXT NOT NULL,
  last_name                   TEXT NOT NULL,
  company_name                TEXT,
  title                       TEXT,
  email                       TEXT,
  phone                       TEXT,
  address_line_1              TEXT,
  address_line_2              TEXT,
  city                        TEXT,
  state                       TEXT,
  zip                         TEXT,
  website                     TEXT,
  assigned_rep_id             UUID REFERENCES users(id) ON DELETE SET NULL,
  captured_at_trade_show_id   UUID REFERENCES trade_shows(id) ON DELETE SET NULL,
  captured_by_user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  interest_level              lead_interest_level,
  interest_description        TEXT,
  follow_up_date              DATE,
  status                      lead_status NOT NULL DEFAULT 'new',
  converted_to_store_id       UUID REFERENCES stores(id) ON DELETE SET NULL,
  notes                       TEXT,
  business_card_image_url     TEXT,
  ocr_extracted_data          JSONB,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at                  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_leads_assigned_rep
  ON leads (assigned_rep_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_status
  ON leads (status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_trade_show
  ON leads (captured_at_trade_show_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_state
  ON leads (state) WHERE deleted_at IS NULL;

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leads_read ON leads;
CREATE POLICY leads_read ON leads
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'superadmin')
    OR public.is_my_partner()
    OR (
      public.get_my_role() = 'sales_rep'
      AND (
        leads.assigned_rep_id   = public.get_effective_user_id()
        OR leads.captured_by_user_id = public.get_effective_user_id()
      )
    )
  );

DROP POLICY IF EXISTS leads_insert ON leads;
CREATE POLICY leads_insert ON leads
  FOR INSERT TO authenticated
  WITH CHECK (
    public.get_my_role() IN ('admin', 'superadmin', 'sales_rep')
    OR public.is_my_partner()
  );

DROP POLICY IF EXISTS leads_update ON leads;
CREATE POLICY leads_update ON leads
  FOR UPDATE TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'superadmin')
    OR public.is_my_partner()
    OR (
      public.get_my_role() = 'sales_rep'
      AND (
        leads.assigned_rep_id   = public.get_effective_user_id()
        OR leads.captured_by_user_id = public.get_effective_user_id()
      )
    )
  );

DROP POLICY IF EXISTS leads_delete ON leads;
CREATE POLICY leads_delete ON leads
  FOR DELETE TO authenticated
  USING (public.get_my_role() IN ('admin', 'superadmin') OR public.is_my_partner());


-- ── 10. trade_show_appointments ────────────────────────────
CREATE TABLE IF NOT EXISTS trade_show_appointments (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_show_id            UUID NOT NULL REFERENCES trade_shows(id) ON DELETE CASCADE,
  slot_start               TIMESTAMPTZ NOT NULL,
  slot_end                 TIMESTAMPTZ NOT NULL CHECK (slot_end > slot_start),
  status                   trade_show_appointment_status NOT NULL DEFAULT 'available',
  booked_by_lead_id        UUID REFERENCES leads(id) ON DELETE SET NULL,
  booked_by_external_name  TEXT,
  booked_by_external_email TEXT,
  booked_by_external_phone TEXT,
  assigned_staff_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trade_show_appts_show
  ON trade_show_appointments (trade_show_id, slot_start);

ALTER TABLE trade_show_appointments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trade_show_appts_read ON trade_show_appointments;
CREATE POLICY trade_show_appts_read ON trade_show_appointments
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'superadmin', 'sales_rep')
    OR public.is_my_partner()
  );

DROP POLICY IF EXISTS trade_show_appts_write ON trade_show_appointments;
CREATE POLICY trade_show_appts_write ON trade_show_appointments
  FOR ALL TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'superadmin')
    OR public.is_my_partner()
    OR (public.get_my_role() = 'sales_rep'
        AND assigned_staff_id = public.get_effective_user_id())
  )
  WITH CHECK (
    public.get_my_role() IN ('admin', 'superadmin')
    OR public.is_my_partner()
    OR public.get_my_role() = 'sales_rep'
  );


-- ── 11. trade_show_booking_tokens (b3 — separate per-kind) ──
CREATE TABLE IF NOT EXISTS trade_show_booking_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_show_id   UUID NOT NULL REFERENCES trade_shows(id) ON DELETE CASCADE,
  token           TEXT NOT NULL UNIQUE,
  email           TEXT,
  expires_at      TIMESTAMPTZ,
  last_used_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trade_show_booking_tokens_show
  ON trade_show_booking_tokens (trade_show_id);

ALTER TABLE trade_show_booking_tokens ENABLE ROW LEVEL SECURITY;
-- No SELECT/INSERT/UPDATE/DELETE policies — service role only.
-- (Token resolution happens server-side via API routes.)


-- ── 12. trunk_shows ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trunk_shows (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id          UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  start_date        DATE NOT NULL,
  end_date          DATE NOT NULL CHECK (end_date >= start_date),
  assigned_rep_id   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status            trunk_show_status NOT NULL DEFAULT 'scheduled',
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_trunk_shows_rep
  ON trunk_shows (assigned_rep_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_trunk_shows_dates
  ON trunk_shows (start_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_trunk_shows_store
  ON trunk_shows (store_id) WHERE deleted_at IS NULL;

ALTER TABLE trunk_shows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trunk_shows_read ON trunk_shows;
CREATE POLICY trunk_shows_read ON trunk_shows
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'superadmin')
    OR public.is_my_partner()
    OR (public.get_my_role() = 'sales_rep'
        AND assigned_rep_id = public.get_effective_user_id())
  );

DROP POLICY IF EXISTS trunk_shows_write ON trunk_shows;
CREATE POLICY trunk_shows_write ON trunk_shows
  FOR ALL TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'superadmin')
    OR public.is_my_partner()
    OR (public.get_my_role() = 'sales_rep'
        AND assigned_rep_id = public.get_effective_user_id())
  )
  WITH CHECK (
    public.get_my_role() IN ('admin', 'superadmin')
    OR public.is_my_partner()
    OR public.get_my_role() = 'sales_rep'
  );


-- ── 13. trunk_show_hours ───────────────────────────────────
CREATE TABLE IF NOT EXISTS trunk_show_hours (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trunk_show_id   UUID NOT NULL REFERENCES trunk_shows(id) ON DELETE CASCADE,
  show_date       DATE NOT NULL,
  open_time       TIME NOT NULL,
  close_time      TIME NOT NULL CHECK (close_time > open_time),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (trunk_show_id, show_date)
);
CREATE INDEX IF NOT EXISTS idx_trunk_show_hours_show
  ON trunk_show_hours (trunk_show_id, show_date);

ALTER TABLE trunk_show_hours ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trunk_show_hours_read ON trunk_show_hours;
CREATE POLICY trunk_show_hours_read ON trunk_show_hours
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'superadmin')
    OR public.is_my_partner()
    OR EXISTS (
      SELECT 1 FROM trunk_shows ts
      WHERE ts.id = trunk_show_hours.trunk_show_id
        AND ts.assigned_rep_id = public.get_effective_user_id()
    )
  );

DROP POLICY IF EXISTS trunk_show_hours_write ON trunk_show_hours;
CREATE POLICY trunk_show_hours_write ON trunk_show_hours
  FOR ALL TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'superadmin')
    OR public.is_my_partner()
    OR EXISTS (
      SELECT 1 FROM trunk_shows ts
      WHERE ts.id = trunk_show_hours.trunk_show_id
        AND ts.assigned_rep_id = public.get_effective_user_id()
    )
  )
  WITH CHECK (
    public.get_my_role() IN ('admin', 'superadmin', 'sales_rep')
    OR public.is_my_partner()
  );


-- ── 13b. office_staff_notification_recipients ─────────────
-- Created BEFORE trunk_show_special_requests because the
-- special-requests SELECT policy joins to it. Postgres
-- validates policy bodies at creation time.
CREATE TABLE IF NOT EXISTS office_staff_notification_recipients (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  email       TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT osnr_user_or_email
    CHECK (user_id IS NOT NULL OR email IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_osnr_active
  ON office_staff_notification_recipients (is_active) WHERE is_active = TRUE;

ALTER TABLE office_staff_notification_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS osnr_read ON office_staff_notification_recipients;
CREATE POLICY osnr_read ON office_staff_notification_recipients
  FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin', 'superadmin') OR public.is_my_partner());

DROP POLICY IF EXISTS osnr_write ON office_staff_notification_recipients;
CREATE POLICY osnr_write ON office_staff_notification_recipients
  FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin', 'superadmin'))
  WITH CHECK (public.get_my_role() IN ('admin', 'superadmin'));


-- ── 14. trunk_show_special_requests ────────────────────────
CREATE TABLE IF NOT EXISTS trunk_show_special_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trunk_show_id     UUID NOT NULL REFERENCES trunk_shows(id) ON DELETE CASCADE,
  request_text      TEXT NOT NULL,
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  status            trunk_show_special_request_status NOT NULL DEFAULT 'open',
  acknowledged_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_special_requests_show
  ON trunk_show_special_requests (trunk_show_id);

ALTER TABLE trunk_show_special_requests ENABLE ROW LEVEL SECURITY;

-- Office staff = active recipient row in office_staff_notification_recipients
-- with a non-null user_id matching the effective user.
DROP POLICY IF EXISTS special_requests_read ON trunk_show_special_requests;
CREATE POLICY special_requests_read ON trunk_show_special_requests
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'superadmin')
    OR public.is_my_partner()
    OR EXISTS (
      SELECT 1 FROM trunk_shows ts
      WHERE ts.id = trunk_show_special_requests.trunk_show_id
        AND ts.assigned_rep_id = public.get_effective_user_id()
    )
    OR EXISTS (
      SELECT 1 FROM office_staff_notification_recipients osnr
      WHERE osnr.user_id = public.get_effective_user_id()
        AND osnr.is_active = TRUE
    )
  );

DROP POLICY IF EXISTS special_requests_insert ON trunk_show_special_requests;
CREATE POLICY special_requests_insert ON trunk_show_special_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    public.get_my_role() IN ('admin', 'superadmin')
    OR public.is_my_partner()
    OR EXISTS (
      SELECT 1 FROM trunk_shows ts
      WHERE ts.id = trunk_show_special_requests.trunk_show_id
        AND ts.assigned_rep_id = public.get_effective_user_id()
    )
  );

DROP POLICY IF EXISTS special_requests_update ON trunk_show_special_requests;
CREATE POLICY special_requests_update ON trunk_show_special_requests
  FOR UPDATE TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'superadmin')
    OR public.is_my_partner()
    OR EXISTS (
      SELECT 1 FROM office_staff_notification_recipients osnr
      WHERE osnr.user_id = public.get_effective_user_id()
        AND osnr.is_active = TRUE
    )
  );


-- ── 15. trunk_show_appointment_slots ───────────────────────
CREATE TABLE IF NOT EXISTS trunk_show_appointment_slots (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trunk_show_id               UUID NOT NULL REFERENCES trunk_shows(id) ON DELETE CASCADE,
  slot_start                  TIMESTAMPTZ NOT NULL,
  slot_end                    TIMESTAMPTZ NOT NULL CHECK (slot_end > slot_start),
  status                      trunk_show_appointment_status NOT NULL DEFAULT 'available',
  customer_first_name         TEXT,
  customer_last_name          TEXT,
  customer_email              TEXT,
  customer_phone              TEXT,
  store_salesperson_name      TEXT,
  purchased                   BOOLEAN NOT NULL DEFAULT FALSE,
  purchased_marked_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  purchased_marked_at         TIMESTAMPTZ,
  notes                       TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trunk_show_slots_show
  ON trunk_show_appointment_slots (trunk_show_id, slot_start);
CREATE INDEX IF NOT EXISTS idx_trunk_show_slots_purchased
  ON trunk_show_appointment_slots (trunk_show_id) WHERE purchased = TRUE;

ALTER TABLE trunk_show_appointment_slots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trunk_show_slots_read ON trunk_show_appointment_slots;
CREATE POLICY trunk_show_slots_read ON trunk_show_appointment_slots
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'superadmin')
    OR public.is_my_partner()
    OR EXISTS (
      SELECT 1 FROM trunk_shows ts
      WHERE ts.id = trunk_show_appointment_slots.trunk_show_id
        AND ts.assigned_rep_id = public.get_effective_user_id()
    )
  );

DROP POLICY IF EXISTS trunk_show_slots_write ON trunk_show_appointment_slots;
CREATE POLICY trunk_show_slots_write ON trunk_show_appointment_slots
  FOR ALL TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'superadmin')
    OR public.is_my_partner()
    OR EXISTS (
      SELECT 1 FROM trunk_shows ts
      WHERE ts.id = trunk_show_appointment_slots.trunk_show_id
        AND ts.assigned_rep_id = public.get_effective_user_id()
    )
  )
  WITH CHECK (
    public.get_my_role() IN ('admin', 'superadmin', 'sales_rep')
    OR public.is_my_partner()
  );


-- ── 16. trunk_show_spiffs ──────────────────────────────────
CREATE TABLE IF NOT EXISTS trunk_show_spiffs (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trunk_show_id            UUID NOT NULL REFERENCES trunk_shows(id) ON DELETE CASCADE,
  appointment_slot_id      UUID NOT NULL REFERENCES trunk_show_appointment_slots(id) ON DELETE CASCADE,
  store_salesperson_name   TEXT NOT NULL,
  amount                   NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  paid_at                  TIMESTAMPTZ,
  paid_by                  UUID REFERENCES users(id) ON DELETE SET NULL,
  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trunk_show_spiffs_show
  ON trunk_show_spiffs (trunk_show_id);
CREATE INDEX IF NOT EXISTS idx_trunk_show_spiffs_unpaid
  ON trunk_show_spiffs (trunk_show_id) WHERE paid_at IS NULL;

ALTER TABLE trunk_show_spiffs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trunk_show_spiffs_read ON trunk_show_spiffs;
CREATE POLICY trunk_show_spiffs_read ON trunk_show_spiffs
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'superadmin')
    OR public.is_my_partner()
    OR EXISTS (
      SELECT 1 FROM trunk_shows ts
      WHERE ts.id = trunk_show_spiffs.trunk_show_id
        AND ts.assigned_rep_id = public.get_effective_user_id()
    )
  );

DROP POLICY IF EXISTS trunk_show_spiffs_write ON trunk_show_spiffs;
CREATE POLICY trunk_show_spiffs_write ON trunk_show_spiffs
  FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin', 'superadmin') OR public.is_my_partner())
  WITH CHECK (public.get_my_role() IN ('admin', 'superadmin') OR public.is_my_partner());


-- ── 17. spiff_config (single-row config) ───────────────────
CREATE TABLE IF NOT EXISTS spiff_config (
  id                                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  default_amount_per_appointment_purchase       NUMERIC(12,2) NOT NULL DEFAULT 20 CHECK (default_amount_per_appointment_purchase >= 0),
  is_active                                     BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at                                    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Seed exactly one row.
INSERT INTO spiff_config (default_amount_per_appointment_purchase, is_active)
SELECT 20, TRUE WHERE NOT EXISTS (SELECT 1 FROM spiff_config);

ALTER TABLE spiff_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS spiff_config_read ON spiff_config;
CREATE POLICY spiff_config_read ON spiff_config
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS spiff_config_write ON spiff_config;
CREATE POLICY spiff_config_write ON spiff_config
  FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin', 'superadmin'))
  WITH CHECK (public.get_my_role() IN ('admin', 'superadmin'));


-- ── 18. trunk_show_booking_tokens (b3) ─────────────────────
CREATE TABLE IF NOT EXISTS trunk_show_booking_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trunk_show_id   UUID NOT NULL REFERENCES trunk_shows(id) ON DELETE CASCADE,
  token           TEXT NOT NULL UNIQUE,
  email           TEXT,
  expires_at      TIMESTAMPTZ,
  last_used_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trunk_show_booking_tokens_show
  ON trunk_show_booking_tokens (trunk_show_id);

ALTER TABLE trunk_show_booking_tokens ENABLE ROW LEVEL SECURITY;
-- No policies — service role only.


-- ── 19. sales_rep_territories ──────────────────────────────
CREATE TABLE IF NOT EXISTS sales_rep_territories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state         TEXT NOT NULL UNIQUE CHECK (length(state) BETWEEN 2 AND 4),
  rep_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by   UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_sales_rep_territories_rep
  ON sales_rep_territories (rep_user_id);

ALTER TABLE sales_rep_territories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_rep_territories_read ON sales_rep_territories;
CREATE POLICY sales_rep_territories_read ON sales_rep_territories
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'superadmin', 'sales_rep')
    OR public.is_my_partner()
  );

DROP POLICY IF EXISTS sales_rep_territories_write ON sales_rep_territories;
CREATE POLICY sales_rep_territories_write ON sales_rep_territories
  FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin', 'superadmin') OR public.is_my_partner())
  WITH CHECK (public.get_my_role() IN ('admin', 'superadmin') OR public.is_my_partner());


-- ── 21. sales_rep_prospecting_notes ────────────────────────
CREATE TABLE IF NOT EXISTS sales_rep_prospecting_notes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_text       TEXT NOT NULL,
  linked_lead_id  UUID REFERENCES leads(id) ON DELETE SET NULL,
  linked_store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prospecting_rep
  ON sales_rep_prospecting_notes (rep_user_id, created_at DESC);

ALTER TABLE sales_rep_prospecting_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prospecting_read ON sales_rep_prospecting_notes;
CREATE POLICY prospecting_read ON sales_rep_prospecting_notes
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'superadmin')
    OR public.is_my_partner()
    OR rep_user_id = public.get_effective_user_id()
  );

DROP POLICY IF EXISTS prospecting_insert ON sales_rep_prospecting_notes;
CREATE POLICY prospecting_insert ON sales_rep_prospecting_notes
  FOR INSERT TO authenticated
  WITH CHECK (
    rep_user_id = public.get_effective_user_id()
    OR public.get_my_role() IN ('admin', 'superadmin')
    OR public.is_my_partner()
  );

DROP POLICY IF EXISTS prospecting_update ON sales_rep_prospecting_notes;
CREATE POLICY prospecting_update ON sales_rep_prospecting_notes
  FOR UPDATE TO authenticated
  USING (
    rep_user_id = public.get_effective_user_id()
    OR public.get_my_role() IN ('admin', 'superadmin')
    OR public.is_my_partner()
  );

DROP POLICY IF EXISTS prospecting_delete ON sales_rep_prospecting_notes;
CREATE POLICY prospecting_delete ON sales_rep_prospecting_notes
  FOR DELETE TO authenticated
  USING (
    rep_user_id = public.get_effective_user_id()
    OR public.get_my_role() IN ('admin', 'superadmin')
    OR public.is_my_partner()
  );


-- ── 22. expense_reports — add trade/trunk show FKs ─────────
-- Decision a1: keep event_id; add nullable trunk_show_id +
-- trade_show_id; relax UNIQUE to a partial that only fires on
-- buying-event reports. Plus a CHECK that exactly one of the
-- three references is set.
ALTER TABLE expense_reports
  ADD COLUMN IF NOT EXISTS trunk_show_id UUID REFERENCES trunk_shows(id) ON DELETE CASCADE;
ALTER TABLE expense_reports
  ADD COLUMN IF NOT EXISTS trade_show_id UUID REFERENCES trade_shows(id) ON DELETE CASCADE;

-- event_id is NOT NULL today. Relax it so a sales-side report
-- can omit it.
ALTER TABLE expense_reports ALTER COLUMN event_id DROP NOT NULL;

-- Drop the old unconditional unique index/constraint on (event_id,
-- user_id) and replace with a partial index that only enforces
-- uniqueness when event_id is set (i.e., buying-event reports).
DO $$
DECLARE
  conname text;
BEGIN
  SELECT c.conname INTO conname
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'expense_reports'
    AND c.contype = 'u'
    AND pg_get_constraintdef(c.oid) ILIKE '%(event_id, user_id)%';
  IF conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE expense_reports DROP CONSTRAINT %I', conname);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_expense_reports_unique_event_user
  ON expense_reports (event_id, user_id) WHERE event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_expense_reports_unique_trunk_user
  ON expense_reports (trunk_show_id, user_id) WHERE trunk_show_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_expense_reports_unique_trade_user
  ON expense_reports (trade_show_id, user_id) WHERE trade_show_id IS NOT NULL;

-- Exactly-one-of constraint. Reports tied to a buying event
-- (event_id set) MUST have the other two NULL, and vice versa.
ALTER TABLE expense_reports DROP CONSTRAINT IF EXISTS expense_reports_one_of_parent;
ALTER TABLE expense_reports
  ADD CONSTRAINT expense_reports_one_of_parent CHECK (
    (CASE WHEN event_id        IS NOT NULL THEN 1 ELSE 0 END)
  + (CASE WHEN trunk_show_id   IS NOT NULL THEN 1 ELSE 0 END)
  + (CASE WHEN trade_show_id   IS NOT NULL THEN 1 ELSE 0 END)
  = 1
);


-- ── 23. Seed module grants for new role + extend old roles ─
-- Sales rep gets dashboard/calendar/expenses + the three new
-- modules. Admin/superadmin get the new modules too. Other
-- roles untouched.
INSERT INTO role_modules (role_id, module_id) VALUES
  ('sales_rep', 'dashboard'),
  ('sales_rep', 'calendar'),
  ('sales_rep', 'expenses'),
  ('sales_rep', 'trade-shows'),
  ('sales_rep', 'trunk-shows'),
  ('sales_rep', 'leads'),
  ('admin',     'trade-shows'),
  ('admin',     'trunk-shows'),
  ('admin',     'leads'),
  ('superadmin','trade-shows'),
  ('superadmin','trunk-shows'),
  ('superadmin','leads')
ON CONFLICT (role_id, module_id) DO NOTHING;


-- ── 24. Seed booth_cost_categories ─────────────────────────
INSERT INTO booth_cost_categories (name, display_order) VALUES
  ('Booth Space', 10),
  ('Lighting',    20),
  ('Showcases',   30),
  ('Carpet',      40),
  ('Furniture',   50),
  ('Internet',    60),
  ('Signage',     70),
  ('Drayage',     80),
  ('Labor',       90),
  ('Insurance',  100),
  ('Electrical', 110)
ON CONFLICT (name) DO NOTHING;


-- ── 25. Touch updated_at triggers (reuse global helper) ────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'touch_updated_at') THEN
    DROP TRIGGER IF EXISTS trg_touch_trade_shows                   ON trade_shows;
    DROP TRIGGER IF EXISTS trg_touch_leads                         ON leads;
    DROP TRIGGER IF EXISTS trg_touch_trade_show_appts              ON trade_show_appointments;
    DROP TRIGGER IF EXISTS trg_touch_trunk_shows                   ON trunk_shows;
    DROP TRIGGER IF EXISTS trg_touch_trunk_show_slots              ON trunk_show_appointment_slots;
    DROP TRIGGER IF EXISTS trg_touch_prospecting_notes             ON sales_rep_prospecting_notes;

    CREATE TRIGGER trg_touch_trade_shows BEFORE UPDATE ON trade_shows
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
    CREATE TRIGGER trg_touch_leads BEFORE UPDATE ON leads
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
    CREATE TRIGGER trg_touch_trade_show_appts BEFORE UPDATE ON trade_show_appointments
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
    CREATE TRIGGER trg_touch_trunk_shows BEFORE UPDATE ON trunk_shows
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
    CREATE TRIGGER trg_touch_trunk_show_slots BEFORE UPDATE ON trunk_show_appointment_slots
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
    CREATE TRIGGER trg_touch_prospecting_notes BEFORE UPDATE ON sales_rep_prospecting_notes
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  END IF;
END $$;


DO $$ BEGIN
  RAISE NOTICE 'Sales Rep + Trade/Trunk Shows Phase 1 schema installed.';
END $$;
