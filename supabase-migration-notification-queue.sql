-- ============================================================
-- Delayed-send queue for the 30-minute contact-info-change debounce.
-- When a store employee edits a customer's phone or email, we don't
-- send a "your contact info was updated" SMS/email immediately — we
-- upsert a row here with scheduled_for = now() + 30 min. If they
-- edit again within that window, the upsert pushes scheduled_for
-- back. A cron processes the queue every 5 minutes.
-- ============================================================

CREATE TABLE IF NOT EXISTS notification_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  template_key TEXT NOT NULL,                              -- e.g., 'contact_info_updated_sms'
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'email')),
  recipient TEXT NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'cancelled', 'failed')),
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notification_queue_unique_per_appt_template UNIQUE (appointment_id, template_key)
);

CREATE INDEX IF NOT EXISTS idx_notification_queue_due
  ON notification_queue(scheduled_for) WHERE status = 'pending';

ALTER TABLE notification_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read notification_queue"
  ON notification_queue FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role IN ('admin','superadmin')));
