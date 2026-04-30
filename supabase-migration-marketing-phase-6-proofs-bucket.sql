-- ============================================================
-- Marketing Phase 6: re-create the marketing-proofs Storage bucket.
--
-- Wiped during the rebuild reset. Phase 6 needs it for multi-file
-- proof uploads. Private; all access via the upload + sign-url
-- routes which use the service role.
--
-- Path scheme: {event_id}/{campaign_id}/v{version}-{i}-{filename}
--
-- Safe to re-run.
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('marketing-proofs', 'marketing-proofs', false)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  RAISE NOTICE 'marketing-proofs Storage bucket installed.';
END $$;
