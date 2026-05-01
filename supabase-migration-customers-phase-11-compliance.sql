-- ============================================================
-- Customers module — PHASE 11: privacy & compliance plumbing
--
-- Adds the customer-data-exports storage bucket (private, signed-URL
-- only) and seeds the default recipient for data-export emails.
--
-- The compliance_actions table itself was created in Phase 1 — this
-- phase only adds the buckets + settings the new flows depend on.
--
-- Safe to re-run.
-- ============================================================

-- Private storage bucket for "Export all data" payloads. JSON dumps,
-- ~tens of KB each. Keep them around for legal record but never
-- expose publicly.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('customer-data-exports', 'customer-data-exports', false, 5242880)  -- 5MB cap
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: admin reads + writes only. Service role bypasses RLS
-- for the API route writes; signed URLs handle the email-attachment
-- delivery without granting public access.
DROP POLICY IF EXISTS customer_data_exports_admin_all ON storage.objects;
CREATE POLICY customer_data_exports_admin_all ON storage.objects
  FOR ALL
  USING (
    bucket_id = 'customer-data-exports' AND EXISTS (
      SELECT 1 FROM public.users u
       JOIN auth.users au ON au.email = u.email
      WHERE au.id = auth.uid() AND u.role IN ('admin', 'superadmin')
    )
  )
  WITH CHECK (
    bucket_id = 'customer-data-exports' AND EXISTS (
      SELECT 1 FROM public.users u
       JOIN auth.users au ON au.email = u.email
      WHERE au.id = auth.uid() AND u.role IN ('admin', 'superadmin')
    )
  );

-- Default recipient for data-export emails. Falls back to the
-- accountant_email setting if missing. Never overwrites a tuned value.
INSERT INTO settings (key, value)
VALUES ('customers.data_export_recipient', '""')
ON CONFLICT (key) DO NOTHING;

-- Grace period for right-to-be-forgotten finalize. Default 7 days
-- per spec; admin-tunable via settings table.
INSERT INTO settings (key, value)
VALUES ('customers.rtf_grace_days', '7')
ON CONFLICT (key) DO NOTHING;

DO $$ BEGIN
  RAISE NOTICE 'customer-data-exports bucket + RTF settings installed.';
END $$;
