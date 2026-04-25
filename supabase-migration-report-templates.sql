-- ============================================================
-- Editable report templates — one row per report id. Lets admins
-- tweak subject lines and copy without a code change.
--
-- Variables in any text field are substituted at send time:
--   {{date}}        — today (or report-specific date), formatted
--   {{weekStart}}   — for weekly summary
--   {{storeName}}   — for per-store reports
--   {{eventDate}}   — for event-recap report
-- ============================================================

CREATE TABLE IF NOT EXISTS report_templates (
  id TEXT PRIMARY KEY,                    -- 'morning-briefing', 'end-of-day', etc.
  subject TEXT NOT NULL DEFAULT '',
  greeting TEXT NOT NULL DEFAULT '',
  header_subtitle TEXT NOT NULL DEFAULT '',
  footer TEXT NOT NULL DEFAULT '',
  shoutout_fallback TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT true,   -- whether the Send button is wired
  send_implemented BOOLEAN NOT NULL DEFAULT false,  -- flips to true as we wire each report
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Seed defaults for the five known reports. Only morning-briefing is fully
-- send-implemented today; the others have their UI + template editor live
-- so admins can tweak copy ahead of the data-assembly being wired.
INSERT INTO report_templates (id, subject, greeting, header_subtitle, footer, shoutout_fallback, send_implemented)
VALUES
  ('morning-briefing',  'Morning briefing — {{date}}',                  'Good morning!',          '{{date}} · Daily recap',                      'BEB Portal · Have a great day!',     'Morning team — let''s make today count.', true),
  ('end-of-day',        'End of day — {{date}}',                        'Day done!',              '{{date}} · End-of-day recap',                 'BEB Portal · Great work today!',     'Solid day, team — see you tomorrow.',     false),
  ('weekly-summary',    'Weekly summary — week of {{weekStart}}',       'Last week''s recap',     'Week of {{weekStart}}',                       'BEB Portal · Weekly Summary',        '',                                          false),
  ('store-performance', 'Store performance — {{storeName}}',            'Store performance',      '{{storeName}}',                               'BEB Portal · Performance Report',    '',                                          false),
  ('event-recap',       'Event recap — {{storeName}} · {{eventDate}}',  'Event recap',            '{{storeName}} · {{eventDate}}',               'BEB Portal · Event Recap',           '',                                          false)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE report_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage report_templates"
  ON report_templates FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role IN ('admin', 'superadmin'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role IN ('admin', 'superadmin'))
  );
