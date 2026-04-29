-- ============================================================
-- Expenses & Invoicing PR 10: trip templates + checklist.
--
-- Partners create reusable templates ("Phoenix 4-day event") with a
-- list of expected expense categories. When a buyer creates a report
-- and applies a template, the detail view shows a checklist —
-- "Don't forget to log: meals (4 days), hotel, rental car" — and
-- items grey out as expenses land in those categories.
--
-- Safe to re-run.
-- ============================================================

-- ── 1. expense_report_templates ──────────────────────────
CREATE TABLE IF NOT EXISTS expense_report_templates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  description         TEXT,
  estimated_days      INT CHECK (estimated_days IS NULL OR estimated_days > 0),
  expected_categories expense_category[] NOT NULL DEFAULT '{}',
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expense_report_templates_active
  ON expense_report_templates(is_active) WHERE is_active = TRUE;

ALTER TABLE expense_report_templates ENABLE ROW LEVEL SECURITY;

-- Anyone signed in can read templates (buyers need to pick from them).
DROP POLICY IF EXISTS templates_select ON expense_report_templates;
CREATE POLICY templates_select ON expense_report_templates FOR SELECT TO public
  USING (
    EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email')
  );

-- Per spec: only partners create / edit / delete templates.
DROP POLICY IF EXISTS templates_manage ON expense_report_templates;
CREATE POLICY templates_manage ON expense_report_templates FOR ALL TO public
  USING (
    EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.is_partner IS TRUE)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.is_partner IS TRUE)
  );

-- ── 2. expense_reports.template_id ───────────────────────
ALTER TABLE expense_reports
  ADD COLUMN IF NOT EXISTS template_id UUID
    REFERENCES expense_report_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_expense_reports_template
  ON expense_reports(template_id) WHERE template_id IS NOT NULL;

-- ── 3. updated_at trigger ────────────────────────────────
DROP TRIGGER IF EXISTS trg_touch_expense_report_templates ON expense_report_templates;
CREATE TRIGGER trg_touch_expense_report_templates
BEFORE UPDATE ON expense_report_templates
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── 4. Verify ────────────────────────────────────────────
DO $$ BEGIN
  RAISE NOTICE 'Trip templates schema installed.';
END $$;
