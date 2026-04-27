-- ============================================================
-- Marketing payments (per-payment ad-spend tracking).
--
-- Replaces the simple events.spend_vdp / spend_newspaper /
-- spend_postcard columns with a richer per-payment model so we
-- can track vendor, payment method, quantity, invoice, linked
-- QR, and per-piece cost.
--
-- spend_spiffs is OUT OF SCOPE — spiffs aren't advertising;
-- that column stays put.
--
-- Run all sections in order. The MIGRATION block at the end
-- creates one marketing_payments row per non-zero spend_* value
-- on existing events, attributing them to the seeded
-- "Legacy / Unknown" payment method so the FK is valid without
-- polluting the real methods list. Counts are reported via
-- RAISE NOTICE so you can verify nothing got lost.
-- ============================================================

-- ── 1. Lookup tables ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS marketing_payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS marketing_payment_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent seeds. Use a CTE so we only insert when absent. label is
-- not unique-constrained (admins can edit later) so we match on the
-- exact original label; once renamed by an admin the seed won't reappear.
INSERT INTO marketing_payment_methods (label, sort_order)
SELECT v.label, v.sort_order
FROM (VALUES
  ('Legacy / Unknown',    99),
  ('Check',                1),
  ('ACH',                  2),
  ('Other',               10)
) AS v(label, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM marketing_payment_methods m WHERE m.label = v.label);

INSERT INTO marketing_payment_types (label, sort_order)
SELECT v.label, v.sort_order
FROM (VALUES
  ('VDP',            1),
  ('Small Postcard', 2),
  ('Newspaper',      3)
) AS v(label, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM marketing_payment_types t WHERE t.label = v.label);

ALTER TABLE marketing_payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_payment_types   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read methods"
  ON marketing_payment_methods FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role IN ('admin','superadmin')));
CREATE POLICY "Superadmins write methods"
  ON marketing_payment_methods FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role = 'superadmin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role = 'superadmin'));

CREATE POLICY "Admins read types"
  ON marketing_payment_types FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role IN ('admin','superadmin')));
CREATE POLICY "Superadmins write types"
  ON marketing_payment_types FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role = 'superadmin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role = 'superadmin'));

-- ── 2. Payments table ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS marketing_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  type_id UUID REFERENCES marketing_payment_types(id) ON DELETE SET NULL,
  vendor TEXT,
  amount NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
  paid_at DATE NOT NULL,
  payment_method_id UUID REFERENCES marketing_payment_methods(id) ON DELETE SET NULL,
  quantity INT CHECK (quantity IS NULL OR quantity >= 0),
  invoice_number TEXT,
  notes TEXT,
  qr_code_id UUID REFERENCES qr_codes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_marketing_payments_store_event ON marketing_payments(store_id, event_id);
CREATE INDEX IF NOT EXISTS idx_marketing_payments_paid_at ON marketing_payments(paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_payments_qr ON marketing_payments(qr_code_id) WHERE qr_code_id IS NOT NULL;

ALTER TABLE marketing_payments ENABLE ROW LEVEL SECURITY;

-- All admins read + write payments. Per-store scoping is enforced at
-- query time in the app via the active brand / store filter, matching
-- the existing pattern used by the rest of the app.
CREATE POLICY "Admins manage marketing_payments"
  ON marketing_payments FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role IN ('admin','superadmin')))
  WITH CHECK (EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role IN ('admin','superadmin')));

-- ── 3. One-time migration of legacy events.spend_* columns ──
--
-- Skips spend_spiffs entirely (out of scope per spec).
-- Skips zero / null values. Vendor "(legacy)", paid_at = event start_date,
-- method = "Legacy / Unknown", notes "Migrated from legacy ad spend".
-- Re-running this block is safe: each row carries a deterministic note
-- and we skip if a payment with the same (event_id, type, vendor, amount,
-- 'Migrated…' note) already exists.

DO $$
DECLARE
  legacy_method UUID;
  type_vdp UUID;
  type_post UUID;
  type_news UUID;
  inserted_count INT := 0;
  ev RECORD;
BEGIN
  SELECT id INTO legacy_method FROM marketing_payment_methods WHERE label = 'Legacy / Unknown' LIMIT 1;
  SELECT id INTO type_vdp  FROM marketing_payment_types WHERE label = 'VDP' LIMIT 1;
  SELECT id INTO type_post FROM marketing_payment_types WHERE label = 'Small Postcard' LIMIT 1;
  SELECT id INTO type_news FROM marketing_payment_types WHERE label = 'Newspaper' LIMIT 1;

  FOR ev IN
    SELECT id, store_id, start_date, spend_vdp, spend_newspaper, spend_postcard
    FROM events
    WHERE COALESCE(spend_vdp, 0) + COALESCE(spend_newspaper, 0) + COALESCE(spend_postcard, 0) > 0
  LOOP
    IF COALESCE(ev.spend_vdp, 0) > 0 THEN
      INSERT INTO marketing_payments (store_id, event_id, type_id, vendor, amount, paid_at, payment_method_id, notes)
      SELECT ev.store_id, ev.id, type_vdp, '(legacy)', ev.spend_vdp, ev.start_date, legacy_method,
             'Migrated from legacy ad spend (events.spend_vdp)'
      WHERE NOT EXISTS (
        SELECT 1 FROM marketing_payments p
        WHERE p.event_id = ev.id AND p.type_id = type_vdp AND p.amount = ev.spend_vdp
          AND p.notes = 'Migrated from legacy ad spend (events.spend_vdp)'
      );
      GET DIAGNOSTICS inserted_count = ROW_COUNT;
    END IF;

    IF COALESCE(ev.spend_postcard, 0) > 0 THEN
      INSERT INTO marketing_payments (store_id, event_id, type_id, vendor, amount, paid_at, payment_method_id, notes)
      SELECT ev.store_id, ev.id, type_post, '(legacy)', ev.spend_postcard, ev.start_date, legacy_method,
             'Migrated from legacy ad spend (events.spend_postcard)'
      WHERE NOT EXISTS (
        SELECT 1 FROM marketing_payments p
        WHERE p.event_id = ev.id AND p.type_id = type_post AND p.amount = ev.spend_postcard
          AND p.notes = 'Migrated from legacy ad spend (events.spend_postcard)'
      );
    END IF;

    IF COALESCE(ev.spend_newspaper, 0) > 0 THEN
      INSERT INTO marketing_payments (store_id, event_id, type_id, vendor, amount, paid_at, payment_method_id, notes)
      SELECT ev.store_id, ev.id, type_news, '(legacy)', ev.spend_newspaper, ev.start_date, legacy_method,
             'Migrated from legacy ad spend (events.spend_newspaper)'
      WHERE NOT EXISTS (
        SELECT 1 FROM marketing_payments p
        WHERE p.event_id = ev.id AND p.type_id = type_news AND p.amount = ev.spend_newspaper
          AND p.notes = 'Migrated from legacy ad spend (events.spend_newspaper)'
      );
    END IF;
  END LOOP;

  RAISE NOTICE 'Marketing migration complete. Total marketing_payments rows: %',
    (SELECT COUNT(*) FROM marketing_payments);
  RAISE NOTICE 'Of which migrated from legacy: %',
    (SELECT COUNT(*) FROM marketing_payments WHERE notes LIKE 'Migrated from legacy ad spend%');
END $$;
