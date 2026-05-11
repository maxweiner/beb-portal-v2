-- ============================================================
-- Storage policies for the wholesale module
--
-- The two buckets `wholesale-photos` and `wholesale-documents`
-- live in Supabase Storage and have to be created via the
-- Dashboard FIRST (Storage → New bucket → Private). This script
-- adds the row-level policies on `storage.objects` so that:
--
--   - any authenticated user the wholesale module already lets in
--     (admin / superadmin / partner — see wholesale_caller_allowed)
--     can read / upload / delete objects in those buckets
--   - everyone else is blocked
--
-- The app uses createSignedUrls() for reading, so the buckets
-- stay private; signed URLs are minted server-side after this
-- policy approves the SELECT.
--
-- Safe to re-run (DROP + CREATE each policy).
-- ============================================================

-- Read
DROP POLICY IF EXISTS wholesale_storage_read ON storage.objects;
CREATE POLICY wholesale_storage_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id IN ('wholesale-photos', 'wholesale-documents')
    AND public.wholesale_caller_allowed()
  );

-- Insert (upload)
DROP POLICY IF EXISTS wholesale_storage_insert ON storage.objects;
CREATE POLICY wholesale_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id IN ('wholesale-photos', 'wholesale-documents')
    AND public.wholesale_caller_allowed()
  );

-- Update (rename / replace metadata — Supabase upload uses upsert
-- in some paths, which counts as UPDATE).
DROP POLICY IF EXISTS wholesale_storage_update ON storage.objects;
CREATE POLICY wholesale_storage_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id IN ('wholesale-photos', 'wholesale-documents')
    AND public.wholesale_caller_allowed()
  )
  WITH CHECK (
    bucket_id IN ('wholesale-photos', 'wholesale-documents')
    AND public.wholesale_caller_allowed()
  );

-- Delete
DROP POLICY IF EXISTS wholesale_storage_delete ON storage.objects;
CREATE POLICY wholesale_storage_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id IN ('wholesale-photos', 'wholesale-documents')
    AND public.wholesale_caller_allowed()
  );

DO $$ BEGIN
  RAISE NOTICE 'Wholesale storage policies installed on storage.objects for buckets wholesale-photos + wholesale-documents.';
END $$;
