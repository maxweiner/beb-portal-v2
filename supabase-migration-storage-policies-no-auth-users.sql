-- ============================================================
-- Fix: storage.objects FOR-ALL policies that referenced auth.users
--
-- Two legacy bucket-specific FOR-ALL policies joined public.users
-- to auth.users by email to check role. Because they are FOR ALL,
-- Postgres parses their WITH CHECK on every INSERT to storage.objects
-- regardless of bucket — and the parse-time access check on
-- auth.users fails for the `authenticated` role (which lacks SELECT
-- on auth.users by default). Result: every wholesale photo / document
-- upload was rejected with the misleading
--   "new row violates row-level security policy"
-- message, even for superadmin partners. The bucket_id filter inside
-- the WITH CHECK only fires at RUNTIME, after planning has already
-- failed.
--
-- Fix: rewrite both policies to use the SECURITY DEFINER helper
-- public.has_any_role() (already in place from the 2026-05-02
-- multi-role refactor). The helper queries public.user_roles and
-- never touches auth.users, so the parse-time access check passes.
--
-- Behaviour preserved:
--   - brand-logos          — superadmin only
--   - customer-data-exports — admin or superadmin
--
-- Safe to re-run.
-- ============================================================

DROP POLICY IF EXISTS brand_logos_storage_superadmin_all ON storage.objects;
CREATE POLICY brand_logos_storage_superadmin_all ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'brand-logos'
    AND public.has_any_role('superadmin')
  )
  WITH CHECK (
    bucket_id = 'brand-logos'
    AND public.has_any_role('superadmin')
  );

DROP POLICY IF EXISTS customer_data_exports_admin_all ON storage.objects;
CREATE POLICY customer_data_exports_admin_all ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'customer-data-exports'
    AND public.has_any_role('admin','superadmin')
  )
  WITH CHECK (
    bucket_id = 'customer-data-exports'
    AND public.has_any_role('admin','superadmin')
  );

DO $$ BEGIN
  RAISE NOTICE 'storage.objects FOR-ALL policies rewritten to avoid auth.users access.';
END $$;
