-- ============================================================
-- Customers module — PHASE 1: schema + enums + RLS + seed tags
--
-- This is the foundation of the Customers module per the spec.
-- Phases 2-12 (CRUD, import tool, dedup queue, marketing filters,
-- buyer access UI, etc.) build on top of this schema. NOTHING in
-- this migration changes existing tables or routes — it only adds.
--
-- Design decisions documented inline against the spec:
-- - One customer = one store (FK customers.store_id NOT NULL)
-- - Soft delete on customers via deleted_at (30-day undo window
--   handled at the JS / cron layer)
-- - Buyer access RLS: events.workers JSONB contains the buyer's id
--   AND today is within (start_date, start_date + 2 days). Events
--   in this codebase don't have an end_date column — the 3-day
--   window is hardcoded everywhere (event_days.day_number 1/2/3).
-- - phone_normalized + email_normalized are GENERATED columns so
--   dedup queries don't have to remember to normalize.
-- - compliance_actions is the only long-lived audit table
--   (right-to-be-forgotten / data export legal record).
--
-- Safe to re-run.
-- ============================================================

-- ── 1. Enums ────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE customer_how_did_you_hear AS ENUM (
    'large_postcard', 'small_postcard', 'newspaper',
    'email', 'text', 'the_store_told_me'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE customer_engagement_tier AS ENUM (
    'active', 'lapsed', 'cold', 'vip'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE customer_mailing_type AS ENUM ('postcard', 'vdp', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE customer_dedup_source AS ENUM ('import', 'appointment', 'manual_entry');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE customer_dedup_status AS ENUM ('pending', 'merged', 'kept_separate', 'dismissed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE compliance_action_type AS ENUM (
    'right_to_be_forgotten_initiated',
    'right_to_be_forgotten_finalized',
    'data_export_request'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. customers ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id                    UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

  first_name                  TEXT NOT NULL,
  last_name                   TEXT NOT NULL,
  address_line_1              TEXT NULL,
  address_line_2              TEXT NULL,
  city                        TEXT NULL,
  state                       TEXT NULL,
  zip                         TEXT NULL,
  phone                       TEXT NULL,
  email                       TEXT NULL,
  date_of_birth               DATE NULL,

  how_did_you_hear            customer_how_did_you_hear NULL,
  how_did_you_hear_legacy     TEXT NULL,
  how_did_you_hear_other_text TEXT NULL,

  notes                       TEXT NULL,
  last_contact_date           DATE NULL,
  do_not_contact              BOOLEAN NOT NULL DEFAULT FALSE,

  engagement_tier             customer_engagement_tier NULL,
  vip_override                BOOLEAN NOT NULL DEFAULT FALSE,
  lifetime_appointment_count  INTEGER NOT NULL DEFAULT 0,
  first_appointment_date      DATE NULL,
  last_appointment_date       DATE NULL,

  -- Generated normalization columns — used for dedup matching.
  -- regexp_replace strips non-digits from phone; lower() normalizes email.
  phone_normalized TEXT GENERATED ALWAYS AS (
    NULLIF(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), '')
  ) STORED,
  email_normalized TEXT GENERATED ALWAYS AS (
    NULLIF(lower(trim(coalesce(email, ''))), '')
  ) STORED,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_customers_store              ON customers(store_id);
CREATE INDEX IF NOT EXISTS idx_customers_deleted            ON customers(deleted_at);
CREATE INDEX IF NOT EXISTS idx_customers_engagement         ON customers(engagement_tier);
CREATE INDEX IF NOT EXISTS idx_customers_last_appt          ON customers(last_appointment_date);
CREATE INDEX IF NOT EXISTS idx_customers_email_norm         ON customers(store_id, email_normalized) WHERE email_normalized IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_phone_norm         ON customers(store_id, phone_normalized) WHERE phone_normalized IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_zip                ON customers(store_id, zip);
CREATE INDEX IF NOT EXISTS idx_customers_dnc                ON customers(do_not_contact);

COMMENT ON TABLE customers IS
  'Per-store customer database. One customer = one store. Imports + appointment auto-create populate this table; marketing exports filter from it.';
COMMENT ON COLUMN customers.how_did_you_hear_legacy IS
  'Free-text "how did you hear" from imported records. Preserves the source value when the structured enum field would lose information.';
COMMENT ON COLUMN customers.engagement_tier IS
  'Computed nightly by the engagement-scoring cron from last_appointment_date + vip_override. NULL until the cron runs once.';
COMMENT ON COLUMN customers.vip_override IS
  'When TRUE, engagement_tier is forced to "vip" regardless of date-based math. Manually set by admins or the cron when lifetime_appointment_count >= configured threshold.';

-- ── 3. customer_tag_definitions (admin-managed master list) ─
CREATE TABLE IF NOT EXISTS customer_tag_definitions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tag         TEXT NOT NULL UNIQUE,
  description TEXT NULL,
  color       TEXT NOT NULL DEFAULT '#1D6B44',
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customer_tag_def_archived ON customer_tag_definitions(is_archived);

-- Seed initial tags. Re-runs upsert color/description but never
-- flip is_archived back on (UI controls that).
INSERT INTO customer_tag_definitions (tag, description, color) VALUES
  ('vip',             'VIP customer — top-tier value.',                                  '#C9A84C'),
  ('repeat_customer', 'Multiple-time customer.',                                          '#1D6B44'),
  ('high_value',      'Above-average lifetime spend.',                                    '#8B5CF6'),
  ('returned_mail',   'A previous mailing was returned undeliverable. Verify address.',   '#DC2626'),
  ('referred',        'Found us through a referral. Worth nurturing the relationship.',   '#3B82F6'),
  ('new_customer',    'First-time customer in the last ~12 months.',                      '#10B981'),
  ('holiday_card',    'Opted in / suggested for the holiday card list.',                  '#D97706')
ON CONFLICT (tag) DO UPDATE SET
  description = EXCLUDED.description,
  color       = EXCLUDED.color;

-- ── 4. customer_tags (junction) ─────────────────────────────
CREATE TABLE IF NOT EXISTS customer_tags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  tag         TEXT NOT NULL REFERENCES customer_tag_definitions(tag) ON UPDATE CASCADE ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (customer_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_customer_tags_customer ON customer_tags(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_tags_tag      ON customer_tags(tag);

-- ── 5. customer_mailings (per-customer history) ─────────────
CREATE TABLE IF NOT EXISTS customer_mailings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id           UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  event_id              UUID NULL REFERENCES events(id) ON DELETE SET NULL,
  marketing_campaign_id UUID NULL REFERENCES marketing_campaigns(id) ON DELETE SET NULL,
  mailed_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  mailing_type          customer_mailing_type NOT NULL,
  notes                 TEXT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customer_mailings_customer ON customer_mailings(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_mailings_campaign ON customer_mailings(marketing_campaign_id);
CREATE INDEX IF NOT EXISTS idx_customer_mailings_event    ON customer_mailings(event_id);
CREATE INDEX IF NOT EXISTS idx_customer_mailings_date     ON customer_mailings(mailed_at);

-- ── 6. customer_imports (bulk-import audit) ─────────────────
CREATE TABLE IF NOT EXISTS customer_imports (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id                 UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  imported_by              UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  imported_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  original_filename        TEXT NULL,
  total_rows               INTEGER NOT NULL DEFAULT 0,
  new_rows                 INTEGER NOT NULL DEFAULT 0,
  duplicate_rows_merged    INTEGER NOT NULL DEFAULT 0,
  duplicate_rows_flagged   INTEGER NOT NULL DEFAULT 0,
  errored_rows             INTEGER NOT NULL DEFAULT 0,
  -- Path within the customer-imports storage bucket. Phase 3 mints
  -- signed URLs from this on demand — never construct a public URL.
  file_url                 TEXT NULL
);
CREATE INDEX IF NOT EXISTS idx_customer_imports_store ON customer_imports(store_id);
CREATE INDEX IF NOT EXISTS idx_customer_imports_date  ON customer_imports(imported_at);

-- ── 7. customer_dedup_review_queue ──────────────────────────
CREATE TABLE IF NOT EXISTS customer_dedup_review_queue (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  existing_customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  incoming_data        JSONB NOT NULL,
  match_confidence     NUMERIC(4,3) NOT NULL CHECK (match_confidence >= 0 AND match_confidence <= 1),
  match_reasons        TEXT[] NOT NULL DEFAULT '{}',
  source               customer_dedup_source NOT NULL,
  status               customer_dedup_status NOT NULL DEFAULT 'pending',
  resolved_by          UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  resolved_at          TIMESTAMPTZ NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dedup_queue_existing ON customer_dedup_review_queue(existing_customer_id);
CREATE INDEX IF NOT EXISTS idx_dedup_queue_status   ON customer_dedup_review_queue(status);
CREATE INDEX IF NOT EXISTS idx_dedup_queue_created  ON customer_dedup_review_queue(created_at);

-- ── 8. compliance_actions (right-to-be-forgotten + exports) ─
CREATE TABLE IF NOT EXISTS compliance_actions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- customer_id stays even after the customer row is hard-deleted —
  -- we keep the action record for legal record-keeping per spec.
  customer_id UUID NULL,
  store_id    UUID NULL,
  -- Snapshot the customer email + name at the time of the action so
  -- the legal record is interpretable even if the row is gone.
  customer_email_snapshot TEXT NULL,
  customer_name_snapshot  TEXT NULL,
  action      compliance_action_type NOT NULL,
  initiated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Free-form blob for any context: scheduled finalize date, export
  -- file URL, recipient email of the export, etc.
  meta        JSONB NULL
);
CREATE INDEX IF NOT EXISTS idx_compliance_actions_customer ON compliance_actions(customer_id);
CREATE INDEX IF NOT EXISTS idx_compliance_actions_action   ON compliance_actions(action);
CREATE INDEX IF NOT EXISTS idx_compliance_actions_created  ON compliance_actions(created_at);

-- ── 9. updated_at triggers ──────────────────────────────────
CREATE OR REPLACE FUNCTION customers_set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_customers_updated_at ON customers;
CREATE TRIGGER trg_customers_updated_at BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION customers_set_updated_at();

DROP TRIGGER IF EXISTS trg_dedup_queue_updated_at ON customer_dedup_review_queue;
CREATE TRIGGER trg_dedup_queue_updated_at BEFORE UPDATE ON customer_dedup_review_queue
  FOR EACH ROW EXECUTE FUNCTION customers_set_updated_at();

-- ── 10. Helper functions for RLS ────────────────────────────

-- Returns TRUE when the current actor is admin or superadmin.
-- Re-uses the same JOIN pattern as get_my_role().
CREATE OR REPLACE FUNCTION customers_actor_is_admin() RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
     JOIN auth.users au ON au.email = u.email
    WHERE au.id = auth.uid()
      AND u.role IN ('admin', 'superadmin')
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Returns TRUE when the current actor is a buyer assigned to an
-- event at the given store AND today falls in the event window
-- (start_date through start_date + 2 days inclusive — events in
-- this codebase are hardcoded 3-day windows, no end_date column).
CREATE OR REPLACE FUNCTION customers_buyer_has_event_access(p_store_id UUID) RETURNS BOOLEAN AS $$
DECLARE
  my_uid UUID;
BEGIN
  SELECT u.id INTO my_uid
    FROM public.users u
    JOIN auth.users au ON au.email = u.email
   WHERE au.id = auth.uid()
   LIMIT 1;
  IF my_uid IS NULL THEN RETURN FALSE; END IF;
  RETURN EXISTS (
    SELECT 1
      FROM events e,
           jsonb_array_elements(coalesce(e.workers, '[]'::jsonb)) w
     WHERE e.store_id = p_store_id
       AND CURRENT_DATE BETWEEN e.start_date AND (e.start_date + INTERVAL '2 days')::DATE
       AND w->>'id' = my_uid::text
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION customers_buyer_has_event_access(UUID) IS
  'RLS helper. TRUE when the current actor is listed in events.workers for an event at the given store whose 3-day window contains today.';

-- ── 11. RLS — customers ─────────────────────────────────────
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

-- SELECT: admin sees everything (incl. soft-deleted); buyer sees
-- non-deleted rows for stores where they have an active event.
DROP POLICY IF EXISTS customers_select_admin ON customers;
CREATE POLICY customers_select_admin ON customers
  FOR SELECT USING (customers_actor_is_admin());

DROP POLICY IF EXISTS customers_select_buyer_event_window ON customers;
CREATE POLICY customers_select_buyer_event_window ON customers
  FOR SELECT USING (
    deleted_at IS NULL
    AND customers_buyer_has_event_access(store_id)
  );

-- INSERT / UPDATE / DELETE: admin only in Phase 1. Phase 7 will add
-- a buyer-can-append-notes policy via a narrow API route.
DROP POLICY IF EXISTS customers_write_admin ON customers;
CREATE POLICY customers_write_admin ON customers
  FOR ALL USING (customers_actor_is_admin())
  WITH CHECK (customers_actor_is_admin());

-- ── 12. RLS — customer_tag_definitions ──────────────────────
ALTER TABLE customer_tag_definitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tag_def_read_authenticated ON customer_tag_definitions;
CREATE POLICY tag_def_read_authenticated ON customer_tag_definitions
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS tag_def_write_admin ON customer_tag_definitions;
CREATE POLICY tag_def_write_admin ON customer_tag_definitions
  FOR ALL USING (customers_actor_is_admin())
  WITH CHECK (customers_actor_is_admin());

-- ── 13. RLS — customer_tags ─────────────────────────────────
ALTER TABLE customer_tags ENABLE ROW LEVEL SECURITY;

-- Tag visibility piggybacks on customer visibility.
DROP POLICY IF EXISTS customer_tags_select ON customer_tags;
CREATE POLICY customer_tags_select ON customer_tags
  FOR SELECT USING (
    customers_actor_is_admin()
    OR EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = customer_tags.customer_id
         AND c.deleted_at IS NULL
         AND customers_buyer_has_event_access(c.store_id)
    )
  );

DROP POLICY IF EXISTS customer_tags_write_admin ON customer_tags;
CREATE POLICY customer_tags_write_admin ON customer_tags
  FOR ALL USING (customers_actor_is_admin())
  WITH CHECK (customers_actor_is_admin());

-- ── 14. RLS — customer_mailings ─────────────────────────────
ALTER TABLE customer_mailings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_mailings_select ON customer_mailings;
CREATE POLICY customer_mailings_select ON customer_mailings
  FOR SELECT USING (
    customers_actor_is_admin()
    OR EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = customer_mailings.customer_id
         AND c.deleted_at IS NULL
         AND customers_buyer_has_event_access(c.store_id)
    )
  );

DROP POLICY IF EXISTS customer_mailings_write_admin ON customer_mailings;
CREATE POLICY customer_mailings_write_admin ON customer_mailings
  FOR ALL USING (customers_actor_is_admin())
  WITH CHECK (customers_actor_is_admin());

-- ── 15. RLS — customer_imports ──────────────────────────────
ALTER TABLE customer_imports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_imports_admin ON customer_imports;
CREATE POLICY customer_imports_admin ON customer_imports
  FOR ALL USING (customers_actor_is_admin())
  WITH CHECK (customers_actor_is_admin());

-- ── 16. RLS — customer_dedup_review_queue ───────────────────
ALTER TABLE customer_dedup_review_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dedup_queue_admin ON customer_dedup_review_queue;
CREATE POLICY dedup_queue_admin ON customer_dedup_review_queue
  FOR ALL USING (customers_actor_is_admin())
  WITH CHECK (customers_actor_is_admin());

-- ── 17. RLS — compliance_actions ────────────────────────────
ALTER TABLE compliance_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS compliance_actions_admin ON compliance_actions;
CREATE POLICY compliance_actions_admin ON compliance_actions
  FOR ALL USING (customers_actor_is_admin())
  WITH CHECK (customers_actor_is_admin());

-- ── 18. Module entry in role_modules so the sidebar can grant ───
-- The CHECK constraint on role_modules.module_id has an enumerated
-- list; add 'customers' to it. Existing row admins/superadmins get
-- the customers module so it shows up in their sidebar after Phase 2
-- builds the page.
ALTER TABLE role_modules DROP CONSTRAINT IF EXISTS role_modules_module_id_check;
ALTER TABLE role_modules ADD CONSTRAINT role_modules_module_id_check CHECK (module_id IN (
  'dashboard', 'calendar', 'events', 'schedule', 'travel',
  'dayentry', 'staff', 'admin', 'libertyadmin', 'stores',
  'data-research', 'reports', 'financials', 'marketing',
  'shipping', 'expenses', 'todo', 'recipients',
  'notification-templates', 'customers'
));

INSERT INTO role_modules (role_id, module_id) VALUES
  ('admin', 'customers'),
  ('superadmin', 'customers')
ON CONFLICT (role_id, module_id) DO NOTHING;

DO $$ BEGIN
  RAISE NOTICE 'Customers module Phase 1 schema installed. Tables: customers, customer_tag_definitions (+ 7 seed tags), customer_tags, customer_mailings, customer_imports, customer_dedup_review_queue, compliance_actions. RLS enabled on all. Module added to role_modules for admin/superadmin.';
END $$;
