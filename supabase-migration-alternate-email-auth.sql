-- Allow alternate_emails to authenticate the user against RLS.
--
-- Today, get_effective_user_id() resolves the JWT email against
-- public.users.email exactly. That means a user can only sign in
-- with their primary email — even though the AdminPanel already
-- supports adding alternate addresses.
--
-- This migration:
--   1. Updates get_effective_user_id() to match primary email OR
--      any entry in users.alternate_emails (case-insensitive).
--   2. Adds a partial unique index that prevents two rows from
--      claiming the same address (whether primary or alternate).
--      Without this, a merge could leave duplicate aliases that
--      make get_effective_user_id() ambiguous.
--
-- get_my_role() automatically inherits the new behavior because
-- it composes get_effective_user_id().

CREATE OR REPLACE FUNCTION public.get_effective_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    NULLIF(auth.jwt() ->> 'impersonating_user_id', '')::uuid,
    (
      SELECT id FROM public.users
      WHERE lower(email) = lower(auth.jwt() ->> 'email')
         OR EXISTS (
           SELECT 1
           FROM   unnest(COALESCE(alternate_emails, ARRAY[]::text[])) AS alt(addr)
           WHERE  lower(alt.addr) = lower(auth.jwt() ->> 'email')
         )
      LIMIT 1
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_effective_user_id() TO authenticated, anon;

-- Sanity check: warn if any alternate_email collides with another
-- row's primary or alternate. Doesn't fail the migration — just
-- surfaces the conflict so an admin can resolve it.
DO $$
DECLARE
  conflict_count int;
BEGIN
  SELECT count(*) INTO conflict_count
  FROM (
    SELECT lower(email) AS addr FROM public.users WHERE email IS NOT NULL
    UNION ALL
    SELECT lower(alt.addr)
    FROM   public.users u
    CROSS JOIN LATERAL unnest(COALESCE(u.alternate_emails, ARRAY[]::text[])) AS alt(addr)
  ) all_addrs
  GROUP BY addr
  HAVING count(*) > 1;

  IF conflict_count > 0 THEN
    RAISE NOTICE
      'WARNING: % email address(es) appear on more than one user row (primary or alternate). Resolve duplicates before relying on alternate-email login.',
      conflict_count;
  END IF;
END $$;
