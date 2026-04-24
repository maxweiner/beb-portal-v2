-- ============================================================
-- QR Code System foundation. Permanent codes that redirect to a
-- booking page (or store-group landing) and log every scan for
-- attribution + analytics. See docs/appointments-spec.md §5.
--
-- Includes the schema for store groups + memberships so the data
-- model is complete from day one, even though the group landing
-- page lands in a later chunk.
-- ============================================================

-- 1. Store groups (named collection of 2+ stores for multi-store QRs)
CREATE TABLE IF NOT EXISTS store_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE,             -- used in /book/group/[slug]
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_store_groups_slug ON store_groups(slug)
  WHERE slug IS NOT NULL;

CREATE TABLE IF NOT EXISTS store_group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_group_id UUID NOT NULL REFERENCES store_groups(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT store_group_members_unique UNIQUE (store_group_id, store_id)
);

CREATE INDEX IF NOT EXISTS idx_store_group_members_group ON store_group_members(store_group_id);
CREATE INDEX IF NOT EXISTS idx_store_group_members_store ON store_group_members(store_id);

-- 2. QR codes (permanent, immutable redirect codes)
CREATE TABLE IF NOT EXISTS qr_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,                                -- 8-char alphanumeric, never changes
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE,    -- null for group QRs
  store_group_id UUID REFERENCES store_groups(id) ON DELETE CASCADE, -- null for store QRs
  type TEXT NOT NULL CHECK (type IN ('channel', 'custom', 'employee', 'group')),
  lead_source TEXT,                                         -- maps to a how_heard option (channel QRs)
  custom_label TEXT,                                        -- for custom-label QRs
  appointment_employee_id UUID REFERENCES appointment_employees(id) ON DELETE SET NULL, -- for employee QRs
  label TEXT NOT NULL,                                      -- human-readable display name
  active BOOLEAN NOT NULL DEFAULT true,
  deleted_at TIMESTAMPTZ,                                   -- soft-delete (60-day trash)
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Either store_id OR store_group_id, not both, not neither
  CONSTRAINT qr_codes_owner_xor CHECK (
    (store_id IS NOT NULL AND store_group_id IS NULL)
    OR (store_id IS NULL AND store_group_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_qr_codes_code ON qr_codes(code);
CREATE INDEX IF NOT EXISTS idx_qr_codes_store ON qr_codes(store_id) WHERE store_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_qr_codes_group ON qr_codes(store_group_id) WHERE store_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_qr_codes_active ON qr_codes(deleted_at) WHERE deleted_at IS NULL;

-- 3. QR scan log (every scan, including non-conversions)
CREATE TABLE IF NOT EXISTS qr_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  qr_code_id UUID NOT NULL REFERENCES qr_codes(id) ON DELETE CASCADE,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  device_type TEXT,                       -- 'mobile' | 'desktop' | 'tablet' | 'bot'
  user_agent TEXT,
  geo_city TEXT,
  geo_region TEXT,
  geo_country TEXT,
  geo_lat NUMERIC,
  geo_lng NUMERIC,
  referrer TEXT,
  ip_hash TEXT,                           -- hashed IP for repeat detection
  is_repeat BOOLEAN NOT NULL DEFAULT false,
  converted BOOLEAN NOT NULL DEFAULT false,
  appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_qr_scans_qr ON qr_scans(qr_code_id);
CREATE INDEX IF NOT EXISTS idx_qr_scans_at ON qr_scans(scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_qr_scans_qr_ip ON qr_scans(qr_code_id, ip_hash) WHERE ip_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_qr_scans_converted ON qr_scans(qr_code_id, converted)
  WHERE converted = true;

-- 4. appointments.qr_code_id — link a booking back to the QR that drove it
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS qr_code_id UUID REFERENCES qr_codes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_appointments_qr ON appointments(qr_code_id) WHERE qr_code_id IS NOT NULL;

-- 5. RLS — admin-only direct access. Public reads/writes go through service-role API routes.
ALTER TABLE store_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE qr_codes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE qr_scans            ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage store_groups"
  ON store_groups FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role IN ('admin','superadmin')))
  WITH CHECK (EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role IN ('admin','superadmin')));

CREATE POLICY "Admins manage store_group_members"
  ON store_group_members FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role IN ('admin','superadmin')))
  WITH CHECK (EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role IN ('admin','superadmin')));

CREATE POLICY "Admins manage qr_codes"
  ON qr_codes FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role IN ('admin','superadmin')))
  WITH CHECK (EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role IN ('admin','superadmin')));

CREATE POLICY "Admins read qr_scans"
  ON qr_scans FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role IN ('admin','superadmin')));
