-- ============================================================
-- Editable templates for every notification the system sends.
-- Variables in any field are substituted at send time:
--   {{customer_name}}, {{store_name}}, {{store_phone}}, {{store_email}}
--   {{date}}, {{time}}                — appointment date / time
--   {{manage_link}}, {{rebook_link}}  — public manage / book pages
--   {{portal_link}}, {{employee_name}} — for welcome emails
-- ============================================================

CREATE TABLE IF NOT EXISTS notification_templates (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'email')),
  subject TEXT,                                   -- email only
  body TEXT NOT NULL,                             -- SMS: full text. Email: HTML body (wrapped in shell at send time)
  description TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage notification_templates"
  ON notification_templates FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role IN ('admin','superadmin')))
  WITH CHECK (EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role IN ('admin','superadmin')));

-- Seeds ---------------------------------------------------------

INSERT INTO notification_templates (id, channel, subject, body, description) VALUES
('sms_confirmation', 'sms', NULL,
  'Hi {{customer_name}}, you''re booked at {{store_name}} on {{date}} at {{time}}. Need to change or cancel? {{manage_link}}',
  'Sent immediately when a customer creates a booking.'),

('email_confirmation', 'email', 'Your appointment at {{store_name}} is confirmed',
  '<p>Hi {{customer_name}},</p>
<p>Your appointment at <strong>{{store_name}}</strong> is confirmed for:</p>
<div style="background:#f5f0e8;border-radius:8px;padding:16px;margin:16px 0;">
  <strong style="font-size:16px;">{{date}}</strong><br/>
  <span style="font-size:16px;">{{time}}</span>
</div>
<p>Need to reschedule or cancel? Use the link below — no login required.</p>
<p style="text-align:center;margin:24px 0;">
  <a href="{{manage_link}}" style="display:inline-block;padding:12px 28px;background:#1D6B44;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">Manage your appointment</a>
</p>',
  'Sent immediately when a customer creates a booking.'),

('sms_reminder_24h', 'sms', NULL,
  'Reminder: your appointment at {{store_name}} is tomorrow ({{date}} at {{time}}). Manage or cancel: {{manage_link}}',
  'Sent automatically 24 hours before an appointment.'),

('email_reminder_24h', 'email', 'Reminder: your appointment at {{store_name}} is tomorrow',
  '<p>Hi {{customer_name}},</p>
<p>This is a reminder that your appointment at <strong>{{store_name}}</strong> is tomorrow:</p>
<div style="background:#f5f0e8;border-radius:8px;padding:16px;margin:16px 0;">
  <strong style="font-size:16px;">{{date}}</strong><br/>
  <span style="font-size:16px;">{{time}}</span>
</div>
<p style="text-align:center;margin:24px 0;">
  <a href="{{manage_link}}" style="display:inline-block;padding:12px 28px;background:#1D6B44;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">Manage your appointment</a>
</p>',
  'Sent automatically 24 hours before an appointment.'),

('sms_reminder_2h', 'sms', NULL,
  'Reminder: your appointment at {{store_name}} is in 2 hours ({{date}} at {{time}}). Manage or cancel: {{manage_link}}',
  'Sent automatically 2 hours before an appointment.'),

('email_reminder_2h', 'email', 'Reminder: your appointment at {{store_name}} is in 2 hours',
  '<p>Hi {{customer_name}},</p>
<p>This is a reminder that your appointment at <strong>{{store_name}}</strong> is in 2 hours:</p>
<div style="background:#f5f0e8;border-radius:8px;padding:16px;margin:16px 0;">
  <strong style="font-size:16px;">{{date}}</strong><br/>
  <span style="font-size:16px;">{{time}}</span>
</div>
<p style="text-align:center;margin:24px 0;">
  <a href="{{manage_link}}" style="display:inline-block;padding:12px 28px;background:#1D6B44;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">Manage your appointment</a>
</p>',
  'Sent automatically 2 hours before an appointment.'),

('sms_cancellation', 'sms', NULL,
  'Your appointment at {{store_name}} on {{date}} at {{time}} has been cancelled. To rebook: {{rebook_link}}',
  'Sent when an appointment is cancelled (by the customer, by staff, or via SMS reply).'),

('email_cancellation', 'email', 'Your appointment at {{store_name}} has been cancelled',
  '<p>Hi {{customer_name}},</p>
<p>Your appointment at <strong>{{store_name}}</strong> on <strong>{{date}} at {{time}}</strong> has been cancelled.</p>
<p style="text-align:center;margin:24px 0;">
  <a href="{{rebook_link}}" style="display:inline-block;padding:12px 28px;background:#1D6B44;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">Book another time</a>
</p>',
  'Sent when an appointment is cancelled.'),

('sms_contact_info_updated', 'sms', NULL,
  'Hi {{customer_name}}, your contact info on your {{store_name}} appointment ({{date}} at {{time}}) has been updated. Manage: {{manage_link}}',
  'Sent 30 minutes after a staff member edits the customer''s phone or email (debounced — only one send even if edited multiple times).'),

('email_contact_info_updated', 'email', 'Your appointment contact info was updated',
  '<p>Hi {{customer_name}},</p>
<p>The contact information on your appointment at <strong>{{store_name}}</strong> has been updated.</p>
<div style="background:#f5f0e8;border-radius:8px;padding:16px;margin:16px 0;">
  <strong style="font-size:16px;">{{date}}</strong><br/>
  <span style="font-size:16px;">{{time}}</span>
</div>
<p style="text-align:center;margin:24px 0;">
  <a href="{{manage_link}}" style="display:inline-block;padding:12px 28px;background:#1D6B44;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">Manage your appointment</a>
</p>',
  'Sent 30 minutes after staff edits the customer''s contact info.'),

('email_welcome', 'email', 'Welcome to the {{store_name}} appointment portal',
  '<p>Hi {{employee_name}},</p>
<p>You''ve been added to the <strong>{{store_name}}</strong> staff portal — where you''ll see and manage every appointment booked through Beneficial Estate Buyers.</p>
<p style="text-align:center;margin:24px 0;">
  <a href="{{portal_link}}" style="display:inline-block;padding:12px 28px;background:#1D6B44;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">Open the staff portal</a>
</p>
<h3 style="margin-top:24px;">Quick start</h3>
<ul style="line-height:1.7;">
  <li>Tap any appointment to edit customer info or change the time.</li>
  <li>Use the + button to add walk-ins or phone-in bookings.</li>
  <li>The Cancelled tab shows past cancellations for reference.</li>
</ul>
<h3>Install on your iPhone</h3>
<p>For the best experience, save the portal as an app on your home screen:</p>
<ol style="line-height:1.7;">
  <li>Open the link above in <strong>Safari</strong> (not Chrome).</li>
  <li>Tap the Share button (square with arrow up) at the bottom.</li>
  <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
  <li>Tap <strong>Add</strong>. The portal icon appears on your home screen — tap it to open full-screen.</li>
</ol>
<p style="font-size:12px;color:#6b7280;margin-top:24px;">Questions? Reply to this email.</p>',
  'Sent manually by a superadmin to onboard new store staff. Variables: {{employee_name}}, {{store_name}}, {{portal_link}}.')
ON CONFLICT (id) DO NOTHING;
