-- ── Liberty / wholesale module: schema ──
--
-- One brand-scoped module shared by Liberty and (eventually) Beneficial.
-- Single wide inventory_items table with a category enum and all
-- category-specific columns nullable on the row. Vendors + customers
-- here are wholesale-counterparties — distinct from the existing
-- `customers` table, which is seller-side from buying events.
--
-- Numbers (J-1001, W-1001, D-1001, M-1001, INV-1001) are sequential
-- per (brand, prefix). A wholesale_number_sequences table + an atomic
-- next_wholesale_number() function keep them collision-free.
--
-- Safe to re-run.
-- ============================================================

-- 1. Enums
DO $$ BEGIN
  CREATE TYPE inventory_category AS ENUM ('jewelry', 'watch', 'diamond');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE inventory_status AS ENUM (
    'in_stock', 'on_memo', 'on_hold', 'sold', 'returned', 'in_repair', 'consigned_out'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE memo_status AS ENUM (
    'open', 'closed_sold', 'closed_returned', 'closed_partial', 'overdue'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE memo_line_status AS ENUM ('out', 'returned', 'sold');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE invoice_payment_status AS ENUM ('unpaid', 'partial', 'paid');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE diamond_lab_type AS ENUM ('GIA', 'AGS', 'IGI', 'GCAL', 'EGL', 'None');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE diamond_data_source AS ENUM ('rapnet', 'gia_scrape', 'manual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Sequence helper — numbers are per (brand, prefix), atomic.
CREATE TABLE IF NOT EXISTS public.wholesale_number_sequences (
  brand        TEXT NOT NULL CHECK (brand IN ('beb','liberty')),
  prefix       TEXT NOT NULL,            -- 'J', 'W', 'D', 'M', 'INV'
  last_number  INT  NOT NULL DEFAULT 1000,
  PRIMARY KEY (brand, prefix)
);

-- Initialize so first issued number per series is 1001.
INSERT INTO public.wholesale_number_sequences (brand, prefix, last_number) VALUES
  ('beb','J',1000), ('beb','W',1000), ('beb','D',1000), ('beb','M',1000), ('beb','INV',1000),
  ('liberty','J',1000), ('liberty','W',1000), ('liberty','D',1000), ('liberty','M',1000), ('liberty','INV',1000)
ON CONFLICT (brand, prefix) DO NOTHING;

CREATE OR REPLACE FUNCTION public.next_wholesale_number(p_brand TEXT, p_prefix TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_n INT;
BEGIN
  UPDATE public.wholesale_number_sequences
     SET last_number = last_number + 1
   WHERE brand = p_brand AND prefix = p_prefix
   RETURNING last_number INTO v_n;
  IF v_n IS NULL THEN
    -- Auto-seed if the brand/prefix is new.
    INSERT INTO public.wholesale_number_sequences (brand, prefix, last_number)
      VALUES (p_brand, p_prefix, 1001)
    ON CONFLICT (brand, prefix) DO UPDATE SET last_number = wholesale_number_sequences.last_number + 1
    RETURNING last_number INTO v_n;
  END IF;
  RETURN p_prefix || '-' || v_n::text;
END;
$$;

-- 3. Locations (admin-managed, brand-scoped)
CREATE TABLE IF NOT EXISTS public.inventory_locations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand        TEXT NOT NULL CHECK (brand IN ('beb','liberty')),
  name         TEXT NOT NULL,
  notes        TEXT,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order   INT NOT NULL DEFAULT 0,
  archived_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_locations_brand_name
  ON public.inventory_locations (brand, name) WHERE archived_at IS NULL;

-- 4. Wholesale vendors
CREATE TABLE IF NOT EXISTS public.wholesale_vendors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand         TEXT NOT NULL CHECK (brand IN ('beb','liberty')),
  company_name  TEXT NOT NULL,
  contact_name  TEXT,
  phone         TEXT,
  email         TEXT,
  address       TEXT,
  notes         TEXT,
  archived_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by    UUID REFERENCES public.users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_wholesale_vendors_brand ON public.wholesale_vendors (brand);

-- 5. Wholesale (dealer) customers
CREATE TABLE IF NOT EXISTS public.wholesale_customers (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand                    TEXT NOT NULL CHECK (brand IN ('beb','liberty')),
  company_name             TEXT NOT NULL,
  contact_name             TEXT,
  phone                    TEXT,
  email                    TEXT,
  address                  TEXT,
  resale_certificate_number TEXT,
  default_payment_terms    TEXT,           -- references admin_lists.list_key='payment_terms'
  notes                    TEXT,
  -- Overpayments park here; applied to next invoice. In cents.
  credit_balance_cents     BIGINT NOT NULL DEFAULT 0,
  archived_at              TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by               UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by               UUID REFERENCES public.users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_wholesale_customers_brand ON public.wholesale_customers (brand);

-- 6. Inventory — single wide table for jewelry, watches, diamonds
CREATE TABLE IF NOT EXISTS public.inventory_items (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand                    TEXT NOT NULL CHECK (brand IN ('beb','liberty')),
  category                 inventory_category NOT NULL,
  item_number              TEXT NOT NULL,                    -- e.g. 'J-1042'
  status                   inventory_status NOT NULL DEFAULT 'in_stock',

  -- Money in cents to avoid float issues.
  cost_cents               BIGINT,
  wholesale_price_cents    BIGINT,
  retail_price_cents       BIGINT,
  insurance_value_cents    BIGINT,

  -- Notes
  internal_notes           TEXT,                              -- never on customer-facing PDFs
  public_notes             TEXT,                              -- description on memos / invoices / appraisals

  vendor_id                UUID REFERENCES public.wholesale_vendors(id) ON DELETE SET NULL,
  location_id              UUID REFERENCES public.inventory_locations(id) ON DELETE SET NULL,
  date_acquired            DATE,

  -- Hold metadata (when status='on_hold')
  hold_for_customer_id     UUID REFERENCES public.wholesale_customers(id) ON DELETE SET NULL,
  hold_expires_at          DATE,

  -- Track which invoice line / memo line currently owns this item.
  current_memo_id          UUID,   -- FK added later (cyclical)
  sold_invoice_id          UUID,   -- FK added later

  -- Jewelry-specific (nullable for other categories)
  jewelry_type             TEXT,                  -- list: 'jewelry_type'
  jewelry_metal_type       TEXT,                  -- list: 'metal_type'
  jewelry_metal_color      TEXT,                  -- list: 'metal_color'
  jewelry_metal_karat      TEXT,                  -- list: 'metal_karat'
  jewelry_metal_grams      NUMERIC(10,2),
  jewelry_diamond_count    INT,
  jewelry_diamond_total_ct NUMERIC(8,3),
  jewelry_diamond_shape    TEXT,                  -- list: 'diamond_shape'
  jewelry_size             TEXT,                  -- ring size, etc.
  jewelry_length           TEXT,                  -- inches/mm
  jewelry_hallmarks        TEXT,
  jewelry_designer         TEXT,
  jewelry_period           TEXT,                  -- list: 'period_era'

  -- Watch-specific
  watch_brand              TEXT,                  -- list: 'watch_brand' (Rolex, Patek, …)
  watch_model              TEXT,
  watch_serial_number      TEXT,
  watch_band_style         TEXT,                  -- list: 'watch_band_style'
  watch_movement_type      TEXT,                  -- list: 'watch_movement'
  watch_year               INT,
  watch_condition          TEXT,                  -- list: 'watch_condition'
  watch_box_papers         TEXT CHECK (watch_box_papers IS NULL OR watch_box_papers IN ('yes','no','partial')),
  watch_complications      TEXT[],                -- multi-select
  watch_case_material      TEXT,                  -- list: 'watch_case_material'
  watch_case_size_mm       NUMERIC(5,1),
  watch_dial_color         TEXT,

  -- Diamond-specific
  diamond_lab_type         diamond_lab_type,
  diamond_report_number    TEXT,
  diamond_shape            TEXT,                  -- list: 'diamond_shape'
  diamond_carat            NUMERIC(8,3),
  diamond_color            TEXT,                  -- D-Z grade
  diamond_clarity          TEXT,                  -- FL, IF, VVS1, …
  diamond_cut              TEXT,                  -- Excellent, Very Good, …
  diamond_polish           TEXT,
  diamond_symmetry         TEXT,
  diamond_fluorescence     TEXT,                  -- None, Faint, Medium, …
  diamond_measurements     TEXT,                  -- 6.50 x 6.45 x 4.00 mm
  diamond_depth_pct        NUMERIC(5,2),
  diamond_table_pct        NUMERIC(5,2),
  diamond_data_source      diamond_data_source,   -- 'rapnet' / 'gia_scrape' / 'manual'

  -- Lifecycle
  archived_at              TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by               UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by               UUID REFERENCES public.users(id) ON DELETE SET NULL,

  -- Category-required fields enforced via CHECK; null otherwise.
  CONSTRAINT inv_diamond_report_required CHECK (
    category <> 'diamond' OR diamond_lab_type IS NULL OR diamond_lab_type = 'None'
    OR (diamond_report_number IS NOT NULL AND diamond_report_number <> '')
  ),
  CONSTRAINT inv_money_nonneg CHECK (
    COALESCE(cost_cents,0) >= 0 AND COALESCE(wholesale_price_cents,0) >= 0
    AND COALESCE(retail_price_cents,0) >= 0 AND COALESCE(insurance_value_cents,0) >= 0
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_items_brand_number
  ON public.inventory_items (brand, item_number);
CREATE INDEX IF NOT EXISTS idx_inventory_items_brand_category_status
  ON public.inventory_items (brand, category, status) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_items_brand_vendor
  ON public.inventory_items (brand, vendor_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_brand_location
  ON public.inventory_items (brand, location_id);
-- Watch / serial lookup
CREATE INDEX IF NOT EXISTS idx_inventory_items_watch_serial
  ON public.inventory_items (brand, watch_serial_number) WHERE watch_serial_number IS NOT NULL;
-- Diamond duplicate prevention: same lab + report# can't exist twice in a brand.
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_items_diamond_report_unique
  ON public.inventory_items (brand, diamond_lab_type, diamond_report_number)
  WHERE category = 'diamond' AND diamond_lab_type IS NOT NULL AND diamond_lab_type <> 'None'
    AND diamond_report_number IS NOT NULL AND archived_at IS NULL;

-- 7. Inventory photos (multi; one flagged primary)
CREATE TABLE IF NOT EXISTS public.inventory_photos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand        TEXT NOT NULL CHECK (brand IN ('beb','liberty')),
  item_id      UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,                -- 'wholesale-photos/<brand>/<item_id>/<file>'
  is_primary   BOOLEAN NOT NULL DEFAULT FALSE,
  caption      TEXT,
  sort_order   INT NOT NULL DEFAULT 0,
  uploaded_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inventory_photos_item ON public.inventory_photos (item_id);
-- At most one primary photo per item (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_photos_one_primary
  ON public.inventory_photos (item_id) WHERE is_primary;

-- 8. Inventory documents (lab reports, provenance, receipts)
CREATE TABLE IF NOT EXISTS public.inventory_documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand        TEXT NOT NULL CHECK (brand IN ('beb','liberty')),
  item_id      UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  filename     TEXT,
  doc_type     TEXT,                          -- 'lab_report', 'receipt', 'provenance', 'other'
  uploaded_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inventory_documents_item ON public.inventory_documents (item_id);

-- 9. Wholesale memos
CREATE TABLE IF NOT EXISTS public.wholesale_memos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand         TEXT NOT NULL CHECK (brand IN ('beb','liberty')),
  memo_number   TEXT NOT NULL,                 -- e.g. 'M-1042'
  customer_id   UUID NOT NULL REFERENCES public.wholesale_customers(id) ON DELETE RESTRICT,
  date_created  DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date      DATE NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '30 days')::date,
  status        memo_status NOT NULL DEFAULT 'open',
  notes         TEXT,
  archived_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by    UUID REFERENCES public.users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wholesale_memos_brand_number
  ON public.wholesale_memos (brand, memo_number);
CREATE INDEX IF NOT EXISTS idx_wholesale_memos_brand_status
  ON public.wholesale_memos (brand, status) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS public.wholesale_memo_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memo_id         UUID NOT NULL REFERENCES public.wholesale_memos(id) ON DELETE CASCADE,
  item_id         UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  memo_price_cents BIGINT NOT NULL CHECK (memo_price_cents >= 0),
  line_status     memo_line_status NOT NULL DEFAULT 'out',
  resolved_at     TIMESTAMPTZ,                  -- when line moved to returned/sold
  invoice_line_id UUID,                         -- when sold; FK added later
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- An item can be on at most one open memo at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_memo_lines_one_open_per_item
  ON public.wholesale_memo_lines (item_id) WHERE line_status = 'out';

-- 10. Wholesale invoices
CREATE TABLE IF NOT EXISTS public.wholesale_invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand           TEXT NOT NULL CHECK (brand IN ('beb','liberty')),
  invoice_number  TEXT NOT NULL,                -- 'INV-1042'
  customer_id     UUID NOT NULL REFERENCES public.wholesale_customers(id) ON DELETE RESTRICT,
  invoice_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_terms   TEXT,
  payment_status  invoice_payment_status NOT NULL DEFAULT 'unpaid',
  notes           TEXT,
  -- Snapshots (computed as lines change)
  subtotal_cents      BIGINT NOT NULL DEFAULT 0,
  tradein_credit_cents BIGINT NOT NULL DEFAULT 0,
  total_due_cents     BIGINT NOT NULL DEFAULT 0,
  paid_cents          BIGINT NOT NULL DEFAULT 0,
  archived_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by      UUID REFERENCES public.users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wholesale_invoices_brand_number
  ON public.wholesale_invoices (brand, invoice_number);
CREATE INDEX IF NOT EXISTS idx_wholesale_invoices_brand_status
  ON public.wholesale_invoices (brand, payment_status) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS public.wholesale_invoice_lines (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id    UUID NOT NULL REFERENCES public.wholesale_invoices(id) ON DELETE CASCADE,
  item_id       UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  description   TEXT,                                    -- snapshot at sale time
  sale_price_cents BIGINT NOT NULL CHECK (sale_price_cents >= 0),
  -- Convenience denorm for reporting
  cost_cents_at_sale BIGINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wholesale_invoice_lines_invoice
  ON public.wholesale_invoice_lines (invoice_id);
CREATE INDEX IF NOT EXISTS idx_wholesale_invoice_lines_item
  ON public.wholesale_invoice_lines (item_id);

-- Trade-in lines: items the customer is selling US. On insert we
-- spawn a new inventory_items row with this customer linked as the
-- vendor. The new item's id is stored back here for traceability.
CREATE TABLE IF NOT EXISTS public.wholesale_invoice_tradein_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      UUID NOT NULL REFERENCES public.wholesale_invoices(id) ON DELETE CASCADE,
  description     TEXT NOT NULL,
  agreed_price_cents BIGINT NOT NULL CHECK (agreed_price_cents >= 0),
  category        inventory_category NOT NULL,
  spawned_item_id UUID REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wholesale_invoice_tradein_lines_invoice
  ON public.wholesale_invoice_tradein_lines (invoice_id);

CREATE TABLE IF NOT EXISTS public.wholesale_invoice_payments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id   UUID NOT NULL REFERENCES public.wholesale_invoices(id) ON DELETE CASCADE,
  brand        TEXT NOT NULL CHECK (brand IN ('beb','liberty')),
  paid_on      DATE NOT NULL DEFAULT CURRENT_DATE,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  method       TEXT,                              -- list: 'payment_method'
  reference    TEXT,                              -- check #, wire confirmation
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   UUID REFERENCES public.users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_wholesale_invoice_payments_invoice
  ON public.wholesale_invoice_payments (invoice_id);

-- Backfill the cyclical FKs now that all tables exist.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_items_current_memo_fk') THEN
    ALTER TABLE public.inventory_items
      ADD CONSTRAINT inventory_items_current_memo_fk
      FOREIGN KEY (current_memo_id) REFERENCES public.wholesale_memos(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_items_sold_invoice_fk') THEN
    ALTER TABLE public.inventory_items
      ADD CONSTRAINT inventory_items_sold_invoice_fk
      FOREIGN KEY (sold_invoice_id) REFERENCES public.wholesale_invoices(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memo_lines_invoice_line_fk') THEN
    ALTER TABLE public.wholesale_memo_lines
      ADD CONSTRAINT memo_lines_invoice_line_fk
      FOREIGN KEY (invoice_line_id) REFERENCES public.wholesale_invoice_lines(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 11. Admin-editable lists (single key/value table)
CREATE TABLE IF NOT EXISTS public.wholesale_admin_lists (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand        TEXT NOT NULL CHECK (brand IN ('beb','liberty')),
  list_key     TEXT NOT NULL,             -- 'metal_type' / 'jewelry_type' / etc.
  value        TEXT NOT NULL,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order   INT NOT NULL DEFAULT 0,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by   UUID REFERENCES public.users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wholesale_admin_lists_unique
  ON public.wholesale_admin_lists (brand, list_key, value);
CREATE INDEX IF NOT EXISTS idx_wholesale_admin_lists_brand_key
  ON public.wholesale_admin_lists (brand, list_key, sort_order) WHERE active;

-- 12. Audit log (brand-scoped, before/after diff stored as JSONB)
CREATE TABLE IF NOT EXISTS public.wholesale_audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand       TEXT NOT NULL CHECK (brand IN ('beb','liberty')),
  entity_type TEXT NOT NULL,                  -- 'inventory_item' / 'memo' / 'invoice' / 'payment' / etc.
  entity_id   UUID,
  action      TEXT NOT NULL,                  -- 'created' / 'updated' / 'deleted' / 'status_changed' / 'cost_edited' / etc.
  before      JSONB,
  after       JSONB,
  actor_id    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  actor_email TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wholesale_audit_log_brand_entity
  ON public.wholesale_audit_log (brand, entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wholesale_audit_log_brand_recent
  ON public.wholesale_audit_log (brand, created_at DESC);

-- 13. RLS — superadmin / admin / partner full access. Brand filtering
--     is at the app layer (matches the rest of this app). Keeps RLS
--     simple + fast and lets the brand switcher work without auth-
--     token gymnastics.
CREATE OR REPLACE FUNCTION public.wholesale_caller_allowed() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.email = auth.jwt()->>'email'
      AND (u.role IN ('superadmin','admin') OR u.is_partner IS TRUE)
  );
$$;

DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'inventory_locations','wholesale_vendors','wholesale_customers',
    'inventory_items','inventory_photos','inventory_documents',
    'wholesale_memos','wholesale_memo_lines',
    'wholesale_invoices','wholesale_invoice_lines',
    'wholesale_invoice_tradein_lines','wholesale_invoice_payments',
    'wholesale_admin_lists','wholesale_audit_log',
    'wholesale_number_sequences'
  ])
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_rw ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_rw ON public.%I FOR ALL TO authenticated
         USING (public.wholesale_caller_allowed())
         WITH CHECK (public.wholesale_caller_allowed())',
      t, t
    );
  END LOOP;
END $$;

-- 14. updated_at touch triggers
CREATE OR REPLACE FUNCTION public.wholesale_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DO $$ DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'inventory_locations','wholesale_vendors','wholesale_customers',
    'inventory_items','wholesale_memos','wholesale_invoices','wholesale_admin_lists'
  ])
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_touch ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%I_touch BEFORE UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.wholesale_touch_updated_at()', t, t
    );
  END LOOP;
END $$;

-- 15. Seed the most common admin lists for Liberty (cheap; no-op if re-run).
INSERT INTO public.wholesale_admin_lists (brand, list_key, value, sort_order) VALUES
  -- jewelry types
  ('liberty','jewelry_type','Bracelet',1),('liberty','jewelry_type','Ring',2),
  ('liberty','jewelry_type','Earrings',3),('liberty','jewelry_type','Necklace',4),
  ('liberty','jewelry_type','Pendant',5),('liberty','jewelry_type','Brooch',6),
  ('liberty','jewelry_type','Watch chain',7),('liberty','jewelry_type','Cufflinks',8),
  ('liberty','jewelry_type','Other',99),
  -- metal type / color / karat
  ('liberty','metal_type','Gold',1),('liberty','metal_type','Platinum',2),
  ('liberty','metal_type','Silver',3),('liberty','metal_type','Other',99),
  ('liberty','metal_color','Yellow',1),('liberty','metal_color','White',2),
  ('liberty','metal_color','Rose',3),('liberty','metal_color','Two-tone',4),
  ('liberty','metal_color','Three-tone',5),
  ('liberty','metal_karat','10k',1),('liberty','metal_karat','14k',2),
  ('liberty','metal_karat','18k',3),('liberty','metal_karat','22k',4),
  ('liberty','metal_karat','24k',5),('liberty','metal_karat','Platinum',6),
  ('liberty','metal_karat','Silver',7),
  -- diamond shape
  ('liberty','diamond_shape','Round',1),('liberty','diamond_shape','Princess',2),
  ('liberty','diamond_shape','Cushion',3),('liberty','diamond_shape','Emerald',4),
  ('liberty','diamond_shape','Oval',5),('liberty','diamond_shape','Pear',6),
  ('liberty','diamond_shape','Marquise',7),('liberty','diamond_shape','Radiant',8),
  ('liberty','diamond_shape','Asscher',9),('liberty','diamond_shape','Heart',10),
  ('liberty','diamond_shape','Old European',11),('liberty','diamond_shape','Old Mine',12),
  ('liberty','diamond_shape','Rose Cut',13),('liberty','diamond_shape','Other',99),
  -- period / era
  ('liberty','period_era','Georgian',1),('liberty','period_era','Victorian',2),
  ('liberty','period_era','Edwardian',3),('liberty','period_era','Art Nouveau',4),
  ('liberty','period_era','Art Deco',5),('liberty','period_era','Retro',6),
  ('liberty','period_era','Mid-Century',7),('liberty','period_era','Modern',8),
  -- watches: brand / band / movement / case material / condition
  ('liberty','watch_brand','Rolex',1),('liberty','watch_brand','Patek Philippe',2),
  ('liberty','watch_brand','Audemars Piguet',3),('liberty','watch_brand','Omega',4),
  ('liberty','watch_brand','Cartier',5),('liberty','watch_brand','IWC',6),
  ('liberty','watch_brand','Vacheron Constantin',7),('liberty','watch_brand','Other',99),
  ('liberty','watch_band_style','Bracelet',1),('liberty','watch_band_style','Leather strap',2),
  ('liberty','watch_band_style','Rubber strap',3),('liberty','watch_band_style','Mesh',4),
  ('liberty','watch_band_style','Other',99),
  ('liberty','watch_movement','Automatic',1),('liberty','watch_movement','Manual',2),
  ('liberty','watch_movement','Quartz',3),('liberty','watch_movement','Spring drive',4),
  ('liberty','watch_case_material','Stainless steel',1),('liberty','watch_case_material','Yellow gold',2),
  ('liberty','watch_case_material','White gold',3),('liberty','watch_case_material','Rose gold',4),
  ('liberty','watch_case_material','Platinum',5),('liberty','watch_case_material','Titanium',6),
  ('liberty','watch_case_material','Two-tone',7),('liberty','watch_case_material','Other',99),
  ('liberty','watch_condition','Mint',1),('liberty','watch_condition','Excellent',2),
  ('liberty','watch_condition','Very good',3),('liberty','watch_condition','Good',4),
  ('liberty','watch_condition','Fair',5),
  -- payment terms + method
  ('liberty','payment_terms','COD',1),('liberty','payment_terms','Wire in advance',2),
  ('liberty','payment_terms','Net 15',3),('liberty','payment_terms','Net 30',4),
  ('liberty','payment_terms','Net 60',5),
  ('liberty','payment_method','Wire',1),('liberty','payment_method','Check',2),
  ('liberty','payment_method','ACH',3),('liberty','payment_method','Cash',4),
  ('liberty','payment_method','Other',99)
ON CONFLICT (brand, list_key, value) DO NOTHING;

DO $$ BEGIN
  RAISE NOTICE 'Wholesale schema installed: 15 tables, RLS, sequences, dropdown seeds for Liberty.';
END $$;
