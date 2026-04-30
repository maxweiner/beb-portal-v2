-- ============================================================
-- Marketing: migrate proof storage to Supabase Storage.
--
-- Today every uploaded proof gets stored as a base64 data URL in
-- marketing_proofs.file_url. That bloats the row (a 5MB image becomes
-- ~7MB of text) and makes Postgres + the JS client work hard for
-- every list query.
--
-- This migration:
--   1. Adds storage_path TEXT NULL — populated by the new upload route
--   2. Creates a private 'marketing-proofs' Storage bucket
--   3. Leaves the legacy file_url column in place so old rows still
--      render (the UI checks: if file_url starts with 'data:', show
--      it directly; else if storage_path is set, fetch a signed URL).
--
-- No backfill — existing rows keep working as-is. New uploads go
-- straight to Storage. Safe to re-run.
-- ============================================================

ALTER TABLE marketing_proofs
  ADD COLUMN IF NOT EXISTS storage_path TEXT NULL;

COMMENT ON COLUMN marketing_proofs.storage_path IS
  'Path inside the marketing-proofs Storage bucket. Mutually exclusive with the legacy data URL in file_url.';

-- Private bucket — no public access. The API route generates short-
-- lived signed URLs for both vendors (token-gated) and admins.
INSERT INTO storage.buckets (id, name, public)
VALUES ('marketing-proofs', 'marketing-proofs', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: no policies = no client access. All reads/writes go
-- through the API routes which use the service role.

DO $$ BEGIN
  RAISE NOTICE 'marketing_proofs.storage_path + marketing-proofs bucket installed.';
END $$;
