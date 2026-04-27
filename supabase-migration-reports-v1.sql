-- ============================================================
-- Custom Reports v1.
--
-- Tables prefixed with `custom_` to avoid colliding with any
-- existing `reports` table (Supabase / your DB already has one
-- with a different shape).
--
-- Builder/runner code reads/writes custom_reports.config jsonb.
-- ============================================================

CREATE TABLE IF NOT EXISTS custom_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  source TEXT NOT NULL,                -- 'appointments' | 'events' | 'qr_scans' | ...
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  visibility TEXT NOT NULL DEFAULT 'global'
    CHECK (visibility IN ('global', 'store', 'private')),
  store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_run_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_custom_reports_visibility_store ON custom_reports (visibility, store_id);
CREATE INDEX IF NOT EXISTS idx_custom_reports_created_by ON custom_reports (created_by);

ALTER TABLE custom_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read custom_reports"
  ON custom_reports FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role IN ('admin','superadmin'))
    AND (
      visibility = 'global'
      OR (visibility = 'store')
      OR created_by = (SELECT id FROM users WHERE email = auth.jwt()->>'email')
      OR EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role = 'superadmin')
    )
  );

CREATE POLICY "Creators and superadmins write custom_reports"
  ON custom_reports FOR ALL TO authenticated
  USING (
    created_by = (SELECT id FROM users WHERE email = auth.jwt()->>'email')
    OR EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role = 'superadmin')
  )
  WITH CHECK (
    created_by = (SELECT id FROM users WHERE email = auth.jwt()->>'email')
    OR EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role = 'superadmin')
  );

CREATE TABLE IF NOT EXISTS custom_report_pins (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_id UUID NOT NULL REFERENCES custom_reports(id) ON DELETE CASCADE,
  pinned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, report_id)
);

CREATE INDEX IF NOT EXISTS idx_custom_report_pins_user ON custom_report_pins (user_id, pinned_at DESC);

ALTER TABLE custom_report_pins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own custom_report_pins"
  ON custom_report_pins FOR ALL TO authenticated
  USING (user_id = (SELECT id FROM users WHERE email = auth.jwt()->>'email'))
  WITH CHECK (user_id = (SELECT id FROM users WHERE email = auth.jwt()->>'email'));
