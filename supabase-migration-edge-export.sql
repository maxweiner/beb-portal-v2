-- ============================================================
-- Edge wholesale-export schema
-- ============================================================
--
-- Adds the "Send to The Edge" feature to the wholesale module.
-- Liberty only at the UI layer (brand gate); brand column stays
-- flexible at the DB layer so future BEB use is a one-line change.
--
-- What's here:
--   - inventory_items.edge_price_cents   (the dedicated Edge ask price)
--   - edge_batches                       (one row per send to Mary @ The Edge)
--   - edge_batch_items                   (frozen snapshot of each item at send time)
--   - edge_recipients                    (brand-scoped recipient/cc/bcc settings)
--
-- Design decisions worth knowing:
--   - edge_price_cents is nullable. NULL = "not ready to send to Edge".
--     This is the validation gate the send view filters on.
--   - edge_batch_items.snapshot is a full JSONB freeze of the item's
--     CSV-column source fields at send time. CSV stays reproducible
--     even if the item is later edited, sold, or deleted. Inventory FK
--     is ON DELETE SET NULL so audit history outlives item deletion.
--   - RLS reuses the existing wholesale_caller_allowed() gate; if you
--     can see/edit wholesale, you can send to Edge. Brand-scoping is
--     enforced at the app layer (matches the rest of the module).
--   - Public batch tokens are minted by the app layer (Node crypto)
--     and stored here — they're how Mary's link works without a login.
--
-- Idempotent: safe to re-run; uses IF NOT EXISTS / DROP IF EXISTS.

-- ─────────────────────────────────────────────────────────────
-- 1. inventory_items.edge_price_cents
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS edge_price_cents BIGINT
    CHECK (edge_price_cents IS NULL OR edge_price_cents >= 0);

-- Filter helper for the send view (cheap when most rows are NULL).
CREATE INDEX IF NOT EXISTS idx_inventory_items_edge_ready
  ON public.inventory_items (brand, status)
  WHERE edge_price_cents IS NOT NULL AND archived_at IS NULL;

-- ─────────────────────────────────────────────────────────────
-- 2. edge_batches  (one row per Send-to-Edge action)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.edge_batches (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand               TEXT NOT NULL CHECK (brand IN ('beb','liberty')),
  batch_code          TEXT NOT NULL UNIQUE,           -- 'EDGE-20260512-A4F2'
  public_token        TEXT NOT NULL UNIQUE,           -- url-safe random, app-minted
  created_by          UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_by_email    TEXT,                           -- frozen so deleted users don't blank
  recipient_email     TEXT NOT NULL,                  -- the primary "to" (Mary)
  recipient_name      TEXT,
  cc_emails           TEXT[]  NOT NULL DEFAULT '{}',  -- includes Max + anyone else
  bcc_emails          TEXT[]  NOT NULL DEFAULT '{}',
  notes               TEXT,                           -- optional message from the sender
  item_count          INTEGER NOT NULL DEFAULT 0,
  photo_count         INTEGER NOT NULL DEFAULT 0,
  csv_path            TEXT,                           -- storage path of the generated CSV
  media_folder        TEXT,                           -- storage prefix where photos live
  media_zip_path      TEXT,                           -- optional zipped bundle path
  status              TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','sent','viewed','revoked','failed')),
  email_provider_id   TEXT,                           -- Resend message id
  email_error         TEXT,
  sent_at             TIMESTAMPTZ,
  first_viewed_at     TIMESTAMPTZ,
  last_viewed_at      TIMESTAMPTZ,
  view_count          INTEGER NOT NULL DEFAULT 0,
  revoked_at          TIMESTAMPTZ,
  revoked_reason      TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_edge_batches_brand_created
  ON public.edge_batches (brand, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_edge_batches_status
  ON public.edge_batches (brand, status, created_at DESC);

-- ─────────────────────────────────────────────────────────────
-- 3. edge_batch_items  (immutable per-item snapshot)
-- ─────────────────────────────────────────────────────────────
--
-- One row per item in a batch, frozen at send time. The `snapshot`
-- JSONB carries every CSV-column source field at the moment of send
-- so re-generating the CSV from a past batch is deterministic even
-- if the underlying item changed, sold, or got deleted.
--
-- Shape of `snapshot` (keys; nulls allowed):
--   item_number, category, description, vendor_name, vendor_stock_number,
--   cost_cents, edge_price_cents, retail_price_cents,
--   metal_type, metal_color, metal_karat, metal_dwt,
--   stones_summary, primary_stone, primary_stone_ct,
--   gender, size, length, designer, period, hallmarks,
--   date_acquired, public_notes
--   (watch_*, diamond_* added when those categories ship)
CREATE TABLE IF NOT EXISTS public.edge_batch_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id            UUID NOT NULL REFERENCES public.edge_batches(id) ON DELETE CASCADE,
  inventory_item_id   UUID REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  position            INTEGER NOT NULL,               -- order in CSV / batch page
  item_number_frozen  TEXT NOT NULL,                  -- SKU at send time
  snapshot            JSONB NOT NULL,
  photo_paths         TEXT[] NOT NULL DEFAULT '{}',   -- storage paths inside media_folder
  photo_count         INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (batch_id, position)
);

CREATE INDEX IF NOT EXISTS idx_edge_batch_items_batch
  ON public.edge_batch_items (batch_id, position);
CREATE INDEX IF NOT EXISTS idx_edge_batch_items_item
  ON public.edge_batch_items (inventory_item_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────
-- 4. edge_recipients  (settings table for to/cc/bcc lists)
-- ─────────────────────────────────────────────────────────────
--
-- Drives the "Send to" dropdown in the composer. role='to' rows are
-- selectable as the primary recipient (one default per brand); role
-- 'cc' / 'bcc' rows are always added unless explicitly removed in the
-- composer.
CREATE TABLE IF NOT EXISTS public.edge_recipients (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand               TEXT NOT NULL CHECK (brand IN ('beb','liberty')),
  email               TEXT NOT NULL,
  name                TEXT,
  role                TEXT NOT NULL DEFAULT 'to'
                      CHECK (role IN ('to','cc','bcc')),
  is_default          BOOLEAN NOT NULL DEFAULT FALSE,
  notes               TEXT,
  archived_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One active row per (brand, role, email).
CREATE UNIQUE INDEX IF NOT EXISTS idx_edge_recipients_active_unique
  ON public.edge_recipients (brand, role, LOWER(email))
  WHERE archived_at IS NULL;

-- One default per (brand, role='to') for the active set.
CREATE UNIQUE INDEX IF NOT EXISTS idx_edge_recipients_one_default
  ON public.edge_recipients (brand)
  WHERE archived_at IS NULL AND role = 'to' AND is_default = TRUE;

-- ─────────────────────────────────────────────────────────────
-- 5. RLS (delegates to existing wholesale_caller_allowed())
-- ─────────────────────────────────────────────────────────────
--
-- Matches the pattern used by every other wholesale_* / inventory_*
-- table. Brand-scoping stays at the app layer.
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'edge_batches','edge_batch_items','edge_recipients'
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

-- Public batch page reads need to bypass auth (Mary has a link, not a
-- login). Done at the app layer via the service-role client — RLS here
-- stays locked to authenticated wholesale users. The public route
-- queries with the service key and gates by token validity.

-- ─────────────────────────────────────────────────────────────
-- 6. updated_at triggers (reuse the existing wholesale helper)
-- ─────────────────────────────────────────────────────────────
DO $$ DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'edge_batches','edge_recipients'
  ])
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_touch ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%I_touch BEFORE UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.wholesale_touch_updated_at()', t, t
    );
  END LOOP;
END $$;

-- edge_batch_items is intentionally immutable post-insert: no
-- updated_at trigger. If the snapshot needs to change, generate a
-- new batch (the resend flow does exactly this).

-- ─────────────────────────────────────────────────────────────
-- 7. Seed Liberty recipients (no-op if rows already exist)
-- ─────────────────────────────────────────────────────────────
--
-- These placeholder rows are deliberately incomplete on email — the
-- Settings UI (PR 3) is where Max fills in the real address. Created
-- here so the send view has something to render on day one.
INSERT INTO public.edge_recipients (brand, role, email, name, is_default, notes)
SELECT 'liberty', 'to', 'mary@theedge.example', 'Mary Moses', TRUE,
       'Placeholder — replace with real address in Settings → Edge Recipients.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.edge_recipients
  WHERE brand = 'liberty' AND role = 'to' AND archived_at IS NULL
);

INSERT INTO public.edge_recipients (brand, role, email, name, notes)
SELECT 'liberty', 'bcc', 'max@bebllp.com', 'Max Weiner',
       'Always BCC the partner on outbound Edge sends.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.edge_recipients
  WHERE brand = 'liberty' AND role = 'bcc' AND LOWER(email) = 'max@bebllp.com' AND archived_at IS NULL
);
