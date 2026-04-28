-- ============================================================
-- Expenses & Invoicing PR 1: schema, RLS, and storage buckets.
--
-- Adds the data model for the expense tracking + compensation
-- invoicing module. No app code changes in this migration —
-- subsequent PRs build the UI, OCR, PDF generator, and approval
-- flow on top.
--
-- Binding decisions (see project memory):
--   - "Trip" = existing events table; foreign keys use event_id.
--   - Partner is a distinct concept from superadmin; tracked via
--     a new users.is_partner boolean (not all superadmins are
--     partners — only Max/Joe/Rich).
--   - Two new private storage buckets: expense-receipts (raw
--     receipts), expense-pdfs (generated reports). No storage
--     RLS policies — access is via service-role + signed URLs
--     issued by API routes that gate on app auth.
--   - Owner can mutate own report only while status = 'active';
--     admin/superadmin can mutate any state. State-machine
--     transitions (active → submitted_pending_review → approved →
--     paid) and the partner-only approval gate live in API routes.
--
-- Safe to re-run.
-- ============================================================

-- ── 1. user-profile additions ─────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS home_address       TEXT,
  ADD COLUMN IF NOT EXISTS signature_url      TEXT,
  ADD COLUMN IF NOT EXISTS magic_inbox_email  TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS is_partner         BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN users.home_address      IS 'Used for mileage calc (Google Distance Matrix from home → store → home).';
COMMENT ON COLUMN users.signature_url     IS 'Optional e-signature image URL rendered in the PDF footer.';
COMMENT ON COLUMN users.magic_inbox_email IS 'Per-user inbound address for the receipt email-in flow (PR 7).';
COMMENT ON COLUMN users.is_partner        IS 'Partner = approves financials, gets $7,500 default rate. Distinct from role=superadmin.';

-- ── 2. enums ──────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE expense_report_status AS ENUM ('active','submitted_pending_review','approved','paid');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE expense_category AS ENUM (
    'flight','rental_car','rideshare','hotel','meals',
    'shipping_supplies','jewelry_lots_cash','mileage','custom'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE expense_source AS ENUM ('manual','travel_module','magic_inbox','ocr','mileage_calc');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE compensation_invoice_status AS ENUM ('active','submitted_pending_review','approved','paid');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE compensation_invoice_type AS ENUM ('single_trip','multi_trip');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── 3. buyer_rates ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS buyer_rates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  default_event_rate  NUMERIC(10,2) CHECK (default_event_rate IS NULL OR default_event_rate >= 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE buyer_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS buyer_rates_select ON buyer_rates;
CREATE POLICY buyer_rates_select ON buyer_rates FOR SELECT TO public
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.email = auth.jwt()->>'email'
        AND (u.id = buyer_rates.user_id OR u.role IN ('admin','superadmin'))
    )
  );

DROP POLICY IF EXISTS buyer_rates_manage ON buyer_rates;
CREATE POLICY buyer_rates_manage ON buyer_rates FOR ALL TO public
  USING (
    EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role IN ('admin','superadmin'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role IN ('admin','superadmin'))
  );

-- ── 4. expense_reports ────────────────────────────────────
CREATE TABLE IF NOT EXISTS expense_reports (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id                 UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status                   expense_report_status NOT NULL DEFAULT 'active',
  submitted_at             TIMESTAMPTZ,
  approved_at              TIMESTAMPTZ,
  approved_by              UUID REFERENCES users(id) ON DELETE SET NULL,
  paid_at                  TIMESTAMPTZ,
  paid_by                  UUID REFERENCES users(id) ON DELETE SET NULL,
  accountant_email_sent_at TIMESTAMPTZ,
  total_expenses           NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_compensation       NUMERIC(12,2) NOT NULL DEFAULT 0,
  grand_total              NUMERIC(12,2) NOT NULL DEFAULT 0,
  pdf_url                  TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_expense_reports_user   ON expense_reports(user_id);
CREATE INDEX IF NOT EXISTS idx_expense_reports_event  ON expense_reports(event_id);
CREATE INDEX IF NOT EXISTS idx_expense_reports_status ON expense_reports(status);

ALTER TABLE expense_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS expense_reports_select ON expense_reports;
CREATE POLICY expense_reports_select ON expense_reports FOR SELECT TO public
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.email = auth.jwt()->>'email'
        AND (u.id = expense_reports.user_id OR u.role IN ('admin','superadmin'))
    )
  );

DROP POLICY IF EXISTS expense_reports_insert ON expense_reports;
CREATE POLICY expense_reports_insert ON expense_reports FOR INSERT TO public
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.email = auth.jwt()->>'email'
        AND (u.id = expense_reports.user_id OR u.role IN ('admin','superadmin'))
    )
  );

-- Owner can update only while in 'active'; admin/superadmin always.
-- State-machine transitions (active → submitted_pending_review → approved
-- → paid) are enforced in API routes.
DROP POLICY IF EXISTS expense_reports_update ON expense_reports;
CREATE POLICY expense_reports_update ON expense_reports FOR UPDATE TO public
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.email = auth.jwt()->>'email'
        AND (
          (u.id = expense_reports.user_id AND expense_reports.status = 'active')
          OR u.role IN ('admin','superadmin')
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.email = auth.jwt()->>'email'
        AND (u.id = expense_reports.user_id OR u.role IN ('admin','superadmin'))
    )
  );

DROP POLICY IF EXISTS expense_reports_delete ON expense_reports;
CREATE POLICY expense_reports_delete ON expense_reports FOR DELETE TO public
  USING (
    EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role IN ('admin','superadmin'))
  );

-- ── 5. expenses ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expenses (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_report_id     UUID NOT NULL REFERENCES expense_reports(id) ON DELETE CASCADE,
  category              expense_category NOT NULL,
  custom_category_label TEXT,
  vendor                TEXT,
  amount                NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  expense_date          DATE NOT NULL,
  notes                 TEXT,
  receipt_url           TEXT,
  source                expense_source NOT NULL DEFAULT 'manual',
  ocr_extracted_data    JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (category <> 'custom' OR custom_category_label IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_expenses_report ON expenses(expense_report_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date   ON expenses(expense_date);

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS expenses_select ON expenses;
CREATE POLICY expenses_select ON expenses FOR SELECT TO public
  USING (
    EXISTS (
      SELECT 1
      FROM expense_reports r
      JOIN users u ON u.email = auth.jwt()->>'email'
      WHERE r.id = expenses.expense_report_id
        AND (u.id = r.user_id OR u.role IN ('admin','superadmin'))
    )
  );

DROP POLICY IF EXISTS expenses_insert ON expenses;
CREATE POLICY expenses_insert ON expenses FOR INSERT TO public
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM expense_reports r
      JOIN users u ON u.email = auth.jwt()->>'email'
      WHERE r.id = expenses.expense_report_id
        AND ((u.id = r.user_id AND r.status = 'active') OR u.role IN ('admin','superadmin'))
    )
  );

DROP POLICY IF EXISTS expenses_update ON expenses;
CREATE POLICY expenses_update ON expenses FOR UPDATE TO public
  USING (
    EXISTS (
      SELECT 1
      FROM expense_reports r
      JOIN users u ON u.email = auth.jwt()->>'email'
      WHERE r.id = expenses.expense_report_id
        AND ((u.id = r.user_id AND r.status = 'active') OR u.role IN ('admin','superadmin'))
    )
  );

DROP POLICY IF EXISTS expenses_delete ON expenses;
CREATE POLICY expenses_delete ON expenses FOR DELETE TO public
  USING (
    EXISTS (
      SELECT 1
      FROM expense_reports r
      JOIN users u ON u.email = auth.jwt()->>'email'
      WHERE r.id = expenses.expense_report_id
        AND ((u.id = r.user_id AND r.status = 'active') OR u.role IN ('admin','superadmin'))
    )
  );

-- ── 6. compensation_invoices ──────────────────────────────
CREATE TABLE IF NOT EXISTS compensation_invoices (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invoice_type             compensation_invoice_type NOT NULL DEFAULT 'single_trip',
  status                   compensation_invoice_status NOT NULL DEFAULT 'active',
  total_amount             NUMERIC(12,2) NOT NULL DEFAULT 0,
  pdf_url                  TEXT,
  period_start             DATE,
  period_end               DATE,
  submitted_at             TIMESTAMPTZ,
  approved_at              TIMESTAMPTZ,
  approved_by              UUID REFERENCES users(id) ON DELETE SET NULL,
  paid_at                  TIMESTAMPTZ,
  paid_by                  UUID REFERENCES users(id) ON DELETE SET NULL,
  accountant_email_sent_at TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    invoice_type = 'single_trip'
    OR (period_start IS NOT NULL AND period_end IS NOT NULL AND period_end >= period_start)
  )
);

CREATE INDEX IF NOT EXISTS idx_compensation_invoices_user   ON compensation_invoices(user_id);
CREATE INDEX IF NOT EXISTS idx_compensation_invoices_status ON compensation_invoices(status);

ALTER TABLE compensation_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS compensation_invoices_select ON compensation_invoices;
CREATE POLICY compensation_invoices_select ON compensation_invoices FOR SELECT TO public
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.email = auth.jwt()->>'email'
        AND (u.id = compensation_invoices.user_id OR u.role IN ('admin','superadmin'))
    )
  );

DROP POLICY IF EXISTS compensation_invoices_insert ON compensation_invoices;
CREATE POLICY compensation_invoices_insert ON compensation_invoices FOR INSERT TO public
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.email = auth.jwt()->>'email'
        AND (u.id = compensation_invoices.user_id OR u.role IN ('admin','superadmin'))
    )
  );

DROP POLICY IF EXISTS compensation_invoices_update ON compensation_invoices;
CREATE POLICY compensation_invoices_update ON compensation_invoices FOR UPDATE TO public
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.email = auth.jwt()->>'email'
        AND (
          (u.id = compensation_invoices.user_id AND compensation_invoices.status = 'active')
          OR u.role IN ('admin','superadmin')
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.email = auth.jwt()->>'email'
        AND (u.id = compensation_invoices.user_id OR u.role IN ('admin','superadmin'))
    )
  );

DROP POLICY IF EXISTS compensation_invoices_delete ON compensation_invoices;
CREATE POLICY compensation_invoices_delete ON compensation_invoices FOR DELETE TO public
  USING (
    EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role IN ('admin','superadmin'))
  );

-- ── 7. compensation_line_items ────────────────────────────
CREATE TABLE IF NOT EXISTS compensation_line_items (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  compensation_invoice_id  UUID NOT NULL REFERENCES compensation_invoices(id) ON DELETE CASCADE,
  event_id                 UUID NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  rate                     NUMERIC(10,2) NOT NULL CHECK (rate >= 0),
  description              TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compensation_line_items_invoice ON compensation_line_items(compensation_invoice_id);
CREATE INDEX IF NOT EXISTS idx_compensation_line_items_event   ON compensation_line_items(event_id);

ALTER TABLE compensation_line_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS compensation_line_items_select ON compensation_line_items;
CREATE POLICY compensation_line_items_select ON compensation_line_items FOR SELECT TO public
  USING (
    EXISTS (
      SELECT 1
      FROM compensation_invoices ci
      JOIN users u ON u.email = auth.jwt()->>'email'
      WHERE ci.id = compensation_line_items.compensation_invoice_id
        AND (u.id = ci.user_id OR u.role IN ('admin','superadmin'))
    )
  );

DROP POLICY IF EXISTS compensation_line_items_insert ON compensation_line_items;
CREATE POLICY compensation_line_items_insert ON compensation_line_items FOR INSERT TO public
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM compensation_invoices ci
      JOIN users u ON u.email = auth.jwt()->>'email'
      WHERE ci.id = compensation_line_items.compensation_invoice_id
        AND ((u.id = ci.user_id AND ci.status = 'active') OR u.role IN ('admin','superadmin'))
    )
  );

DROP POLICY IF EXISTS compensation_line_items_update ON compensation_line_items;
CREATE POLICY compensation_line_items_update ON compensation_line_items FOR UPDATE TO public
  USING (
    EXISTS (
      SELECT 1
      FROM compensation_invoices ci
      JOIN users u ON u.email = auth.jwt()->>'email'
      WHERE ci.id = compensation_line_items.compensation_invoice_id
        AND ((u.id = ci.user_id AND ci.status = 'active') OR u.role IN ('admin','superadmin'))
    )
  );

DROP POLICY IF EXISTS compensation_line_items_delete ON compensation_line_items;
CREATE POLICY compensation_line_items_delete ON compensation_line_items FOR DELETE TO public
  USING (
    EXISTS (
      SELECT 1
      FROM compensation_invoices ci
      JOIN users u ON u.email = auth.jwt()->>'email'
      WHERE ci.id = compensation_line_items.compensation_invoice_id
        AND ((u.id = ci.user_id AND ci.status = 'active') OR u.role IN ('admin','superadmin'))
    )
  );

-- ── 8. updated_at touch triggers ──────────────────────────
-- touch_updated_at() is defined globally in supabase-migration-shipping-pr1.sql.
DROP TRIGGER IF EXISTS trg_touch_buyer_rates              ON buyer_rates;
DROP TRIGGER IF EXISTS trg_touch_expense_reports          ON expense_reports;
DROP TRIGGER IF EXISTS trg_touch_expenses                 ON expenses;
DROP TRIGGER IF EXISTS trg_touch_compensation_invoices    ON compensation_invoices;
DROP TRIGGER IF EXISTS trg_touch_compensation_line_items  ON compensation_line_items;

CREATE TRIGGER trg_touch_buyer_rates             BEFORE UPDATE ON buyer_rates             FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_expense_reports         BEFORE UPDATE ON expense_reports         FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_expenses                BEFORE UPDATE ON expenses                FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_compensation_invoices   BEFORE UPDATE ON compensation_invoices   FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_compensation_line_items BEFORE UPDATE ON compensation_line_items FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── 9. Storage buckets ────────────────────────────────────
-- Both private (no public read). Access strictly via service-role
-- key + signed URLs from API routes that gate on app auth. No
-- storage.objects RLS policies — Supabase denies by default.
INSERT INTO storage.buckets (id, name, public)
VALUES ('expense-receipts', 'expense-receipts', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('expense-pdfs', 'expense-pdfs', false)
ON CONFLICT (id) DO NOTHING;

-- ── 10. Verify ────────────────────────────────────────────
DO $$
DECLARE
  reports_count INT;
  expenses_count INT;
BEGIN
  SELECT COUNT(*) INTO reports_count  FROM expense_reports;
  SELECT COUNT(*) INTO expenses_count FROM expenses;
  RAISE NOTICE 'Expenses schema installed. expense_reports rows: %, expenses rows: %', reports_count, expenses_count;
END $$;
