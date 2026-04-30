-- ============================================================
-- Typo fix in can_manage_roles(): email was 'max@bebll.com',
-- should be 'max@bebllp.com' (the LLP). PR A's schema landed with
-- the typo so the Role Manager GUI never appeared for the intended
-- user.
--
-- Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION can_manage_roles() RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = auth.uid()
      AND lower(email) = 'max@bebllp.com'
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

DO $$ BEGIN
  RAISE NOTICE 'can_manage_roles() now grants max@bebllp.com (was max@bebll.com).';
END $$;
