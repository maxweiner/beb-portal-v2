-- ============================================================
-- has_marketing_access() now also returns true for role='marketing'
--
-- Before: gated only by users.marketing_access boolean. A new user
-- with role='marketing' but the boolean unset (or stale) couldn't
-- see any campaigns even though that's exactly what the role is for.
--
-- After: role='marketing' OR marketing_access=true unlocks all RLS
-- on marketing tables. Matches the user's mental model: "the role
-- grants the access."
--
-- Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION has_marketing_access() RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT (u.marketing_access OR u.role = 'marketing')
       FROM users u
       JOIN auth.users au ON au.email = u.email
      WHERE au.id = auth.uid()
      LIMIT 1),
    FALSE
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Belt + suspenders: backfill marketing_access=true on every
-- existing role='marketing' user, so non-RLS code paths that read
-- the column directly also work.
UPDATE public.users SET marketing_access = TRUE
  WHERE role = 'marketing' AND marketing_access IS DISTINCT FROM TRUE;

DO $$ BEGIN
  RAISE NOTICE 'has_marketing_access() now also accepts role=marketing.';
END $$;
