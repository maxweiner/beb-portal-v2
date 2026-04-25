-- ============================================================
-- Tracks welcome / onboarding emails sent to store staff +
-- the store owner. Powers the "Sent / Opened" status display in
-- the Store Employee Management section of the admin.
--
-- store_employee_id is nullable so we can also log sends to the
-- store owner (who isn't represented in store_employees).
-- ============================================================

CREATE TABLE IF NOT EXISTS welcome_email_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  store_employee_id UUID REFERENCES store_employees(id) ON DELETE SET NULL,
  recipient_email TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  opened_at TIMESTAMPTZ,
  sent_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resend_message_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_welcome_email_log_store ON welcome_email_log(store_id);
CREATE INDEX IF NOT EXISTS idx_welcome_email_log_employee ON welcome_email_log(store_employee_id) WHERE store_employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_welcome_email_log_resend ON welcome_email_log(resend_message_id) WHERE resend_message_id IS NOT NULL;

ALTER TABLE welcome_email_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage welcome_email_log"
  ON welcome_email_log FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role IN ('admin','superadmin')))
  WITH CHECK (EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role IN ('admin','superadmin')));
