-- ============================================================
-- report_templates seed: expense-submit-reminder
--
-- Adds a row to the existing report_templates table so admins can
-- edit the "submit your expense report" reminder copy from
-- Reports → Templates → Expense Submit Reminder, without a code
-- change. Falls back to the inline default in
-- lib/expenses/sendSubmitReminder.ts if the row is disabled or
-- missing.
--
-- Field reuse for this transactional template:
--   subject            → email subject
--   greeting           → opening greeting line   ("Hi {{buyerName}},")
--   shoutout_fallback  → body paragraph          (the explanatory sentence)
--   footer             → closing line            (the "we'll nudge again" line)
--   header_subtitle    → unused (hidden in the editor when sendEndpoint=null)
--
-- Variables substituted at send time:
--   {{buyerName}}    — recipient's name
--   {{eventName}}    — event store_name
--   {{eventDate}}    — formatted event date  (e.g. "April 21, 2026")
--   {{ordinal}}      — "Reminder" / "Second reminder" / "Final reminder"
--   {{closingLine}}  — auto-built copy that varies by attempt number
--
-- Safe to re-run.
-- ============================================================

INSERT INTO report_templates
  (id, subject, greeting, header_subtitle, footer, shoutout_fallback, send_implemented, enabled)
VALUES (
  'expense-submit-reminder',
  '{{ordinal}}: please submit your expense report — {{eventName}}',
  'Hi {{buyerName}},',
  '',
  '{{closingLine}}',
  'Your expense report for <strong>{{eventName}}</strong> ({{eventDate}}) is still in <em>active</em> status — please add any remaining receipts and submit it for review.',
  false,
  true
)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  RAISE NOTICE 'expense-submit-reminder report_templates row inserted (or already present).';
END $$;
