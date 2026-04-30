-- ============================================================
-- Marketing module: full wipe before rebuild against the new spec.
--
-- The existing tables (marketing_campaigns / marketing_proofs /
-- marketing_zips / marketing_vendors / marketing_emails_sent) have
-- shapes incompatible with the new spec's data model (flow_type,
-- sub_status, magic_link_tokens, vdp/postcard details split, multi-
-- file proofs with versioning, approver / payment-method tables, etc).
--
-- No real production data is associated. Drop everything so the
-- rebuild's Phase 1 schema migration can land on a clean slate.
--
-- After this runs, the Marketing tab in the portal will show a
-- "module being rebuilt" placeholder until Phase 1 lands.
--
-- Safe to re-run.
-- ============================================================

-- 1. Tables — CASCADE so dependent FKs (proofs → campaigns, etc.)
--    don't block the drop.
DROP TABLE IF EXISTS marketing_emails_sent CASCADE;
DROP TABLE IF EXISTS marketing_proofs       CASCADE;
DROP TABLE IF EXISTS marketing_zips         CASCADE;
DROP TABLE IF EXISTS marketing_campaigns    CASCADE;
DROP TABLE IF EXISTS marketing_vendors      CASCADE;

-- 2. Per-event token column on events — replaced by per-campaign
--    magic_link_tokens table in the spec.
ALTER TABLE events DROP COLUMN IF EXISTS marketing_token;

-- 3. Storage: bucket cleanup is intentionally NOT done here. Supabase
--    blocks DELETE FROM storage.objects / storage.buckets via SQL —
--    has to go through the Storage API. Two options:
--      a) Delete the 'marketing-proofs' bucket from the Supabase
--         dashboard (Storage → bucket → ⋮ → Empty + Delete).
--      b) Leave the bucket in place; Phase 1 of the rebuild can
--         reuse it (no real data to worry about).
--    Either is fine. The schema is now wiped regardless.

DO $$ BEGIN
  RAISE NOTICE 'Marketing module wiped (schema only). Bucket cleanup is manual via dashboard if desired.';
END $$;
