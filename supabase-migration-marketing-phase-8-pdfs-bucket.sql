-- ============================================================
-- Marketing Phase 8: marketing-pdfs Storage bucket
--
-- Holds the auto-generated accountant receipt PDF for each campaign
-- on Mark as Paid. Path: {campaign_id}.pdf
--
-- Private; all access via the API routes (service role).
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('marketing-pdfs', 'marketing-pdfs', false)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  RAISE NOTICE 'marketing-pdfs Storage bucket installed.';
END $$;
