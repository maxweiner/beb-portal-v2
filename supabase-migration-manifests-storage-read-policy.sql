-- ============================================================
-- Fix: manifest photos never appear in the viewer modal.
--
-- The first version of this migration gated the SELECT on
-- get_my_role() — but that function returns NULL when called from
-- Supabase's Storage service context (the storage server's JWT
-- forwarding doesn't reliably set auth.email() for SECURITY DEFINER
-- function calls). Result: createSignedUrl returns 400 for everyone.
--
-- Fix: simpler policy that matches the existing
-- "Authenticated users can read license photos" pattern — any
-- authenticated user can read any object in the manifests bucket.
-- The shipping_manifests TABLE-level RLS already gates access at
-- the row layer; storage just needs to permit the signed-URL
-- generation.
--
-- Safe to re-run.
-- ============================================================

DROP POLICY IF EXISTS "manifests_read" ON storage.objects;

CREATE POLICY "manifests_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'manifests');

DO $$ BEGIN
  RAISE NOTICE 'manifests bucket SELECT policy installed (bucket-only check).';
END $$;
