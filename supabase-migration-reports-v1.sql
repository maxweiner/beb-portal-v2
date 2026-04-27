-- ============================================================
-- Custom Reports v1.
--
-- One source-of-truth table for saved reports + a per-user pins
-- table for sidebar shortcuts. Builder/runner code reads/writes
-- reports.config jsonb (no rigid schema for filters/columns yet so
-- we can iterate without further migrations).
-- ============================================================

CREATE TABLE IF NOT EXISTS reports (
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

CREATE INDEX IF NOT EXISTS idx_reports_visibility_store ON reports (visibility, store_id);
CREATE INDEX IF NOT EXISTS idx_reports_created_by ON reports (created_by);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

-- READ: global to all admins/superadmins; store-scoped only to that store's
-- admins (we use the active brand path here — there's no per-user
-- store-membership model yet, so admin = sees their brand). private = creator
-- and superadmins.
CREATE POLICY "Admins read reports"
  ON reports FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role IN ('admin','superadmin'))
    AND (
      visibility = 'global'
      OR (visibility = 'store')                            -- store-shared visible to all admins for now
      OR created_by = (SELECT id FROM users WHERE email = auth.jwt()->>'email')
      OR EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role = 'superadmin')
    )
  );

-- WRITE: creator + superadmins.
CREATE POLICY "Creators and superadmins write reports"
  ON reports FOR ALL TO authenticated
  USING (
    created_by = (SELECT id FROM users WHERE email = auth.jwt()->>'email')
    OR EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role = 'superadmin')
  )
  WITH CHECK (
    created_by = (SELECT id FROM users WHERE email = auth.jwt()->>'email')
    OR EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role = 'superadmin')
  );

-- Per-user pins for the sidebar. Cap of 5 enforced in app code.
CREATE TABLE IF NOT EXISTS report_pins (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  pinned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, report_id)
);

CREATE INDEX IF NOT EXISTS idx_report_pins_user ON report_pins (user_id, pinned_at DESC);

ALTER TABLE report_pins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own report_pins"
  ON report_pins FOR ALL TO authenticated
  USING (user_id = (SELECT id FROM users WHERE email = auth.jwt()->>'email'))
  WITH CHECK (user_id = (SELECT id FROM users WHERE email = auth.jwt()->>'email'));
