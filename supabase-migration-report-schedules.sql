-- ============================================================
-- Reports v2 PR 1: per-(template, brand) schedules + recipients.
--
-- Data model:
--   - report_templates (existing) — shared text content (subject,
--     greeting, footer, ...) per template id. ONE row per template,
--     applies to all brands.
--   - report_template_schedules (NEW) — per (template, brand)
--     enabled flag, frequency (daily/weekly/monthly), time of day,
--     day-of-week / day-of-month, and last_sent_at watermark.
--   - report_template_recipients (NEW) — per (template, brand, user)
--     join table. Replaces the global users.notify_beb /
--     users.notify_liberty columns going forward.
--
-- This PR seeds the daily-briefing template + schedules + recipients
-- from the existing notify_* columns so behavior is preserved when
-- the dispatcher takes over (PR 3). Old /api/daily-report cron stays
-- in vercel.json untouched for now.
--
-- Safe to re-run.
-- ============================================================

-- ── 1. Schedules table ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS report_template_schedules (
  template_id TEXT NOT NULL REFERENCES report_templates(id) ON DELETE CASCADE,
  brand TEXT NOT NULL CHECK (brand IN ('beb', 'liberty')),
  enabled BOOLEAN NOT NULL DEFAULT false,
  frequency TEXT NOT NULL DEFAULT 'daily' CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  time_of_day TIME NOT NULL DEFAULT '12:00:00',
  weekly_day INT CHECK (weekly_day IS NULL OR (weekly_day BETWEEN 0 AND 6)),
  monthly_day INT CHECK (monthly_day IS NULL OR (monthly_day BETWEEN 1 AND 31)),
  last_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (template_id, brand)
);

CREATE INDEX IF NOT EXISTS idx_report_template_schedules_enabled
  ON report_template_schedules (enabled) WHERE enabled = true;

ALTER TABLE report_template_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read schedules" ON report_template_schedules;
CREATE POLICY "Admins read schedules"
  ON report_template_schedules FOR SELECT TO public
  USING (get_my_role() IN ('admin', 'superadmin'));

DROP POLICY IF EXISTS "Admins manage schedules" ON report_template_schedules;
CREATE POLICY "Admins manage schedules"
  ON report_template_schedules FOR ALL TO public
  USING (get_my_role() IN ('admin', 'superadmin'))
  WITH CHECK (get_my_role() IN ('admin', 'superadmin'));

-- ── 2. Recipients table ────────────────────────────────────
CREATE TABLE IF NOT EXISTS report_template_recipients (
  template_id TEXT NOT NULL REFERENCES report_templates(id) ON DELETE CASCADE,
  brand TEXT NOT NULL CHECK (brand IN ('beb', 'liberty')),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (template_id, brand, user_id)
);

CREATE INDEX IF NOT EXISTS idx_report_template_recipients_lookup
  ON report_template_recipients (template_id, brand);

ALTER TABLE report_template_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read recipients" ON report_template_recipients;
CREATE POLICY "Admins read recipients"
  ON report_template_recipients FOR SELECT TO public
  USING (get_my_role() IN ('admin', 'superadmin'));

DROP POLICY IF EXISTS "Admins manage recipients" ON report_template_recipients;
CREATE POLICY "Admins manage recipients"
  ON report_template_recipients FOR ALL TO public
  USING (get_my_role() IN ('admin', 'superadmin'))
  WITH CHECK (get_my_role() IN ('admin', 'superadmin'));

-- ── 3. Seed the daily-briefing template row ────────────────
INSERT INTO report_templates (
  id, subject, greeting, header_subtitle, footer, shoutout_fallback,
  enabled, send_implemented
) VALUES (
  'daily-briefing',
  '{{emoji}} {{brandLabel}} — Daily Briefing — {{date}}',
  '{{emoji}} {{brandLabel}} — Daily Briefing',
  '{{date}}',
  '{{brandLabel}} Buyer Portal · Daily Briefing',
  '',
  true,
  true
) ON CONFLICT (id) DO NOTHING;

-- ── 4. Seed both brand schedules at the existing cron's cadence
INSERT INTO report_template_schedules (template_id, brand, enabled, frequency, time_of_day)
VALUES
  ('daily-briefing', 'beb',     true, 'daily', '12:00:00'),
  ('daily-briefing', 'liberty', true, 'daily', '12:00:00')
ON CONFLICT (template_id, brand) DO NOTHING;

-- ── 5. Seed recipients from the existing notify_* columns ──
INSERT INTO report_template_recipients (template_id, brand, user_id)
SELECT 'daily-briefing', 'beb', u.id
FROM users u
WHERE u.active = true
  AND u.role IN ('admin', 'superadmin')
  AND u.notify_beb = true
ON CONFLICT (template_id, brand, user_id) DO NOTHING;

INSERT INTO report_template_recipients (template_id, brand, user_id)
SELECT 'daily-briefing', 'liberty', u.id
FROM users u
WHERE u.active = true
  AND u.role IN ('admin', 'superadmin')
  AND u.notify_liberty = true
ON CONFLICT (template_id, brand, user_id) DO NOTHING;

-- ── 6. Verify ──────────────────────────────────────────────
DO $$
DECLARE
  beb_count INT;
  liberty_count INT;
BEGIN
  SELECT COUNT(*) INTO beb_count
    FROM report_template_recipients
    WHERE template_id = 'daily-briefing' AND brand = 'beb';
  SELECT COUNT(*) INTO liberty_count
    FROM report_template_recipients
    WHERE template_id = 'daily-briefing' AND brand = 'liberty';
  RAISE NOTICE 'Daily Briefing recipients seeded — beb: %, liberty: %', beb_count, liberty_count;
END $$;
