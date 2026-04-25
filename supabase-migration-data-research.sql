-- ============================================================
-- Data Research foundation:
--   1. qr_campaign_sends — per (QR, event) "pieces mailed" counter
--   2. vdp_dropped notification trigger seeded for both brands
--
-- Conversion math on the Data Research page is appointments / total_sent
-- so we need somewhere to store the campaign send volume per event
-- (a single QR is reused across events but each event's marketing
-- drop has its own piece count).
-- ============================================================

CREATE TABLE IF NOT EXISTS qr_campaign_sends (
  qr_code_id UUID NOT NULL REFERENCES qr_codes(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  total_sent INT NOT NULL DEFAULT 0 CHECK (total_sent >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (qr_code_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_qr_campaign_sends_event ON qr_campaign_sends(event_id);

ALTER TABLE qr_campaign_sends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read qr_campaign_sends"
  ON qr_campaign_sends FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM users u
    WHERE u.email = auth.jwt()->>'email' AND u.role IN ('admin','superadmin')
  ));

CREATE POLICY "Superadmins write qr_campaign_sends"
  ON qr_campaign_sends FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM users u
    WHERE u.email = auth.jwt()->>'email' AND u.role IN ('admin','superadmin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM users u
    WHERE u.email = auth.jwt()->>'email' AND u.role IN ('admin','superadmin')
  ));

-- ── vdp_dropped trigger templates ────────────────────────────
-- Fires when the 2nd scan of a VDP / Postcard / similar channel QR
-- lands within an event's campaign window. Per-brand so copy can
-- diverge between BEB and Liberty.

INSERT INTO notification_templates (
  id, brand, trigger_type, channel, name, enabled, channels, delay_minutes,
  email_subject, email_body_html, email_body_text, sms_body,
  body, description
)
VALUES
  ('beb_vdp_dropped', 'beb', 'vdp_dropped', 'email',
    'VDP Dropped (2 scans)', true, ARRAY['email','sms'], 0,
    'VDP dropped — {{event_name}} ({{channel_source}})',
    '<p>Heads up — the <strong>{{channel_source}}</strong> for <strong>{{event_name}}</strong> on {{event_dates}} ({{event_city}}) just hit its second scan.</p>
<p>The campaign appears to be dropping. Check live performance:</p>
<p><a href="{{portal_url}}">{{portal_url}}</a></p>',
    'Heads up — the {{channel_source}} for {{event_name}} on {{event_dates}} ({{event_city}}) just hit its second scan. The campaign appears to be dropping. {{portal_url}}',
    'Heads up — the {{channel_source}} for {{event_name}} on {{event_dates}} ({{event_city}}) just hit its second scan. The campaign appears to be dropping. {{portal_url}}',
    'Heads up — the {{channel_source}} for {{event_name}} on {{event_dates}} ({{event_city}}) just hit its second scan. The campaign appears to be dropping. {{portal_url}}',
    'Fires the moment a VDP / Postcard / similar channel QR records its second scan within an event campaign window. One alert per (event, source).'),

  ('liberty_vdp_dropped', 'liberty', 'vdp_dropped', 'email',
    'VDP Dropped (2 scans)', true, ARRAY['email','sms'], 0,
    'VDP dropped — {{event_name}} ({{channel_source}})',
    '<p>Heads up — the <strong>{{channel_source}}</strong> for <strong>{{event_name}}</strong> on {{event_dates}} ({{event_city}}) just hit its second scan.</p>
<p>The campaign appears to be dropping. Check live performance:</p>
<p><a href="{{portal_url}}">{{portal_url}}</a></p>',
    'Heads up — the {{channel_source}} for {{event_name}} on {{event_dates}} ({{event_city}}) just hit its second scan. The campaign appears to be dropping. {{portal_url}}',
    'Heads up — the {{channel_source}} for {{event_name}} on {{event_dates}} ({{event_city}}) just hit its second scan. The campaign appears to be dropping. {{portal_url}}',
    'Heads up — the {{channel_source}} for {{event_name}} on {{event_dates}} ({{event_city}}) just hit its second scan. The campaign appears to be dropping. {{portal_url}}',
    'Fires the moment a VDP / Postcard / similar channel QR records its second scan within an event campaign window. One alert per (event, source).')
ON CONFLICT (id) DO NOTHING;
