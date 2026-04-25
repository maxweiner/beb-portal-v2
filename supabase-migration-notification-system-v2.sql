-- ============================================================
-- Notification system v2 — brand-scoped, multi-trigger, delayed.
--
-- Adds three things on top of the existing notification_templates
-- (which stays in place to keep the appointment-flow notifications
-- working untouched):
--
--   1. New columns on notification_templates so the SAME table can
--      also hold the brand-scoped, multi-channel, delayed templates
--      driven by a trigger registry. Legacy rows stay with brand
--      and trigger_type NULL — they are still resolved by their
--      flat string id from lib/appointments/notifications.ts.
--   2. scheduled_notifications — the delayed-send queue. Each row
--      represents one notification owed to one recipient for one
--      (brand, trigger, related_event_id) tuple, with per-channel
--      status tracking so partial sends are recorded correctly.
--   3. notification_settings — per-brand admin alert email + quiet
--      hours config + default sender + default timezone.
--
-- Worker / dispatcher details (rate limit, retries, quiet hours)
-- live in app code in Phase 3 and are not encoded in the schema
-- beyond the `processing` transient status.
-- ============================================================

-- ── 1. Extend notification_templates ───────────────────────────

ALTER TABLE notification_templates
  ADD COLUMN IF NOT EXISTS brand TEXT
    CHECK (brand IS NULL OR brand IN ('beb', 'liberty')),
  ADD COLUMN IF NOT EXISTS trigger_type TEXT,
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS channels TEXT[],
  ADD COLUMN IF NOT EXISTS delay_minutes INT NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS email_subject TEXT,
  ADD COLUMN IF NOT EXISTS email_body_html TEXT,
  ADD COLUMN IF NOT EXISTS email_body_text TEXT,
  ADD COLUMN IF NOT EXISTS sms_body TEXT,
  ADD COLUMN IF NOT EXISTS respect_quiet_hours_email BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS respect_quiet_hours_sms BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- One template per (brand, trigger_type). Legacy rows have brand/trigger
-- NULL and are excluded from this constraint via the partial index.
CREATE UNIQUE INDEX IF NOT EXISTS notification_templates_brand_trigger_key
  ON notification_templates (brand, trigger_type)
  WHERE brand IS NOT NULL AND trigger_type IS NOT NULL;

-- Tighten RLS to superadmin-only writes on this table. Reads stay
-- open to admin+superadmin so the existing template editor can still
-- list templates for non-superadmins (read-only view).
DROP POLICY IF EXISTS "Admins manage notification_templates" ON notification_templates;

CREATE POLICY "Admins read notification_templates"
  ON notification_templates FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM users u
    WHERE u.email = auth.jwt()->>'email' AND u.role IN ('admin','superadmin')
  ));

CREATE POLICY "Superadmins write notification_templates"
  ON notification_templates FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM users u
    WHERE u.email = auth.jwt()->>'email' AND u.role = 'superadmin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM users u
    WHERE u.email = auth.jwt()->>'email' AND u.role = 'superadmin'
  ));

-- ── 2. scheduled_notifications ────────────────────────────────

CREATE TABLE IF NOT EXISTS scheduled_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  brand TEXT NOT NULL CHECK (brand IN ('beb', 'liberty')),
  trigger_type TEXT NOT NULL,
  template_id TEXT REFERENCES notification_templates(id) ON DELETE SET NULL,

  recipient_buyer_id UUID REFERENCES users(id) ON DELETE CASCADE,
  recipient_email TEXT,
  recipient_phone TEXT,
  recipient_timezone TEXT,

  channels TEXT[] NOT NULL,
  merge_data JSONB NOT NULL DEFAULT '{}'::jsonb,

  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'held', 'sent', 'cancelled', 'failed')),
  -- Per-channel status so a partial send (e.g. SMS held by quiet hours,
  -- email already delivered) is recorded correctly.
  email_status TEXT
    CHECK (email_status IS NULL OR email_status IN ('pending', 'sent', 'failed', 'skipped', 'held')),
  sms_status TEXT
    CHECK (sms_status IS NULL OR sms_status IN ('pending', 'sent', 'failed', 'skipped', 'held')),

  sent_at TIMESTAMPTZ,
  cancelled_reason TEXT,
  error_message TEXT,
  retry_count INT NOT NULL DEFAULT 0,
  hold_reason TEXT,

  related_event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  related_appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Worker scan index — picks up due rows fast.
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_due
  ON scheduled_notifications (scheduled_for)
  WHERE status IN ('pending', 'held');

-- Idempotency: at most one in-flight notification per (buyer, trigger, event).
-- Re-enqueue after cancel works because cancelled rows are excluded.
CREATE UNIQUE INDEX IF NOT EXISTS scheduled_notifications_inflight_key
  ON scheduled_notifications (recipient_buyer_id, trigger_type, related_event_id)
  WHERE status IN ('pending', 'held', 'processing');

-- Lookup index for the status-badge component.
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_event_buyer
  ON scheduled_notifications (related_event_id, recipient_buyer_id);

ALTER TABLE scheduled_notifications ENABLE ROW LEVEL SECURITY;

-- Admins can read rows for their accessible brand(s); superadmins can write
-- (cancel/send-now). Service role bypasses RLS for the worker.
CREATE POLICY "Admins read scheduled_notifications"
  ON scheduled_notifications FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM users u
    WHERE u.email = auth.jwt()->>'email' AND u.role IN ('admin','superadmin')
  ));

CREATE POLICY "Superadmins write scheduled_notifications"
  ON scheduled_notifications FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM users u
    WHERE u.email = auth.jwt()->>'email' AND u.role = 'superadmin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM users u
    WHERE u.email = auth.jwt()->>'email' AND u.role = 'superadmin'
  ));

-- ── 3. notification_settings ──────────────────────────────────

CREATE TABLE IF NOT EXISTS notification_settings (
  brand TEXT PRIMARY KEY CHECK (brand IN ('beb', 'liberty')),
  admin_alert_email TEXT,
  default_from_email TEXT NOT NULL DEFAULT 'noreply@bebllp.com',
  quiet_hours_enabled BOOLEAN NOT NULL DEFAULT true,
  quiet_hours_start TIME NOT NULL DEFAULT '21:00',
  quiet_hours_end TIME NOT NULL DEFAULT '08:00',
  default_timezone TEXT NOT NULL DEFAULT 'America/New_York',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE notification_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read notification_settings"
  ON notification_settings FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM users u
    WHERE u.email = auth.jwt()->>'email' AND u.role IN ('admin','superadmin')
  ));

CREATE POLICY "Superadmins write notification_settings"
  ON notification_settings FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM users u
    WHERE u.email = auth.jwt()->>'email' AND u.role = 'superadmin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM users u
    WHERE u.email = auth.jwt()->>'email' AND u.role = 'superadmin'
  ));

-- Seed one settings row per brand.
INSERT INTO notification_settings (brand) VALUES ('beb'), ('liberty')
  ON CONFLICT (brand) DO NOTHING;

-- ── 4. claim_due_notifications RPC ────────────────────────────
-- Atomically claims a batch of due rows for the dispatcher. Uses
-- FOR UPDATE SKIP LOCKED so concurrent worker invocations never
-- pick the same row. Marks claimed rows as 'processing' so a
-- crashed worker leaves them visibly stuck (admin can re-queue).

CREATE OR REPLACE FUNCTION claim_due_notifications(batch_size INT DEFAULT 50)
RETURNS SETOF scheduled_notifications
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT id FROM scheduled_notifications
    WHERE status IN ('pending', 'held')
      AND scheduled_for <= now()
    ORDER BY scheduled_for ASC
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE scheduled_notifications n
  SET status = 'processing', updated_at = now()
  FROM due
  WHERE n.id = due.id
  RETURNING n.*;
END;
$$;

-- ── 5. Seed scaffold templates per brand ──────────────────────
-- One row per (brand × trigger_type). buyer_added_to_event ships
-- enabled with the spec's default body; the other three are
-- placeholders disabled by default — superadmin fills them in
-- when ready.

INSERT INTO notification_templates (
  id, brand, trigger_type, channel, name, enabled, channels, delay_minutes,
  email_subject, email_body_html, email_body_text, sms_body,
  body, description
)
VALUES
  ('beb_buyer_added_to_event', 'beb', 'buyer_added_to_event', 'email',
    'Buyer Added to Event', true, ARRAY['email','sms'], 15,
    'You''ve been added to {{event_name}}',
    '<p>Dear {{first_name}},</p>
<p>You have been added to <strong>{{event_name}}</strong> on {{event_dates}} in the city of <strong>{{event_city}}</strong>.</p>
<p>You will be with {{other_buyers}}.</p>
<p>Don''t forget to check travel arrangements in <a href="{{travel_share_link}}">your Travel Share page</a> and then forward all booking confirmations to <strong>travel@bebllp.com</strong>.</p>',
    'Dear {{first_name}}, you have been added to {{event_name}} on {{event_dates}} in the city of {{event_city}}. You will be with {{other_buyers}}. Don''t forget to check travel arrangements in {{travel_share_link}} and then forward all booking confirmations to travel@bebllp.com.',
    'Dear {{first_name}}, you have been added to {{event_name}} on {{event_dates}} in the city of {{event_city}}. You will be with {{other_buyers}}. Don''t forget to check travel arrangements in {{travel_share_link}} and then forward all booking confirmations to travel@bebllp.com.',
    'Dear {{first_name}}, you have been added to {{event_name}} on {{event_dates}} in the city of {{event_city}}. You will be with {{other_buyers}}. Don''t forget to check travel arrangements in {{travel_share_link}} and then forward all booking confirmations to travel@bebllp.com.',
    'Sent to a buyer 15 minutes after they are added to an event.'),

  ('liberty_buyer_added_to_event', 'liberty', 'buyer_added_to_event', 'email',
    'Buyer Added to Event', true, ARRAY['email','sms'], 15,
    'You''ve been added to {{event_name}}',
    '<p>Dear {{first_name}},</p>
<p>You have been added to <strong>{{event_name}}</strong> on {{event_dates}} in the city of <strong>{{event_city}}</strong>.</p>
<p>You will be with {{other_buyers}}.</p>
<p>Don''t forget to check travel arrangements in <a href="{{travel_share_link}}">your Travel Share page</a> and then forward all booking confirmations to <strong>travel@bebllp.com</strong>.</p>',
    'Dear {{first_name}}, you have been added to {{event_name}} on {{event_dates}} in the city of {{event_city}}. You will be with {{other_buyers}}. Don''t forget to check travel arrangements in {{travel_share_link}} and then forward all booking confirmations to travel@bebllp.com.',
    'Dear {{first_name}}, you have been added to {{event_name}} on {{event_dates}} in the city of {{event_city}}. You will be with {{other_buyers}}. Don''t forget to check travel arrangements in {{travel_share_link}} and then forward all booking confirmations to travel@bebllp.com.',
    'Dear {{first_name}}, you have been added to {{event_name}} on {{event_dates}} in the city of {{event_city}}. You will be with {{other_buyers}}. Don''t forget to check travel arrangements in {{travel_share_link}} and then forward all booking confirmations to travel@bebllp.com.',
    'Sent to a buyer 15 minutes after they are added to an event.'),

  -- Scaffolds — disabled by default, empty bodies. Filling them in via
  -- the editor will turn them on without any code changes.
  ('beb_event_reminder_day_before', 'beb', 'event_reminder_day_before', 'email',
    'Event Reminder (Day Before)', false, ARRAY['email','sms'], 0,
    NULL, NULL, NULL, NULL, '', 'Sent the day before an event. Fill in via editor to enable.'),
  ('liberty_event_reminder_day_before', 'liberty', 'event_reminder_day_before', 'email',
    'Event Reminder (Day Before)', false, ARRAY['email','sms'], 0,
    NULL, NULL, NULL, NULL, '', 'Sent the day before an event. Fill in via editor to enable.'),

  ('beb_event_cancelled', 'beb', 'event_cancelled', 'email',
    'Event Cancelled', false, ARRAY['email','sms'], 0,
    NULL, NULL, NULL, NULL, '', 'Sent when an event is cancelled. Fill in via editor to enable.'),
  ('liberty_event_cancelled', 'liberty', 'event_cancelled', 'email',
    'Event Cancelled', false, ARRAY['email','sms'], 0,
    NULL, NULL, NULL, NULL, '', 'Sent when an event is cancelled. Fill in via editor to enable.'),

  ('beb_event_follow_up', 'beb', 'event_follow_up', 'email',
    'Event Follow-up', false, ARRAY['email','sms'], 0,
    NULL, NULL, NULL, NULL, '', 'Sent some time after an event. Fill in via editor to enable.'),
  ('liberty_event_follow_up', 'liberty', 'event_follow_up', 'email',
    'Event Follow-up', false, ARRAY['email','sms'], 0,
    NULL, NULL, NULL, NULL, '', 'Sent some time after an event. Fill in via editor to enable.')
ON CONFLICT (id) DO NOTHING;
