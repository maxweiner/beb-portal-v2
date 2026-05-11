-- ============================================================
-- Make wholesale_caller_allowed() robust + include inventory_access
--
-- Old definition:
--   - Matched users solely by case-sensitive exact email
--   - Recognised only superadmin / admin / is_partner
--
-- That left two real-world holes:
--
--   1. JWT email casing drift. auth.users.email and public.users.email
--      can disagree on case (signup-flow migration, alternate-email
--      logic, etc), and the strict `=` comparison silently misses
--      the user. We've seen superadmins hit "new row violates row-
--      level security policy" because of this.
--
--   2. The per-user inventory_access flag (PR #564) opens the
--      Inventory module on the client but RLS still refused writes
--      for those users — they could see screens but every save
--      400'd.
--
-- New definition:
--   - Matches by auth.uid() = u.auth_id FIRST (the rock-solid path)
--     then falls back to case-insensitive trimmed email match
--     OR a hit in alternate_emails
--   - Permits superadmin / admin / is_partner / inventory_access
--
-- Same signature + SECURITY DEFINER so every policy that depends
-- on it picks up the new behaviour with no policy-level edits.
--
-- Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public.wholesale_caller_allowed() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE
      -- Identity match: auth_id is the JWT subject; the email +
      -- alternate_emails paths are belt-and-suspenders for
      -- accounts where auth_id never got backfilled.
      (
        u.auth_id = auth.uid()
        OR LOWER(BTRIM(u.email)) = LOWER(BTRIM(auth.jwt()->>'email'))
        OR LOWER(BTRIM(auth.jwt()->>'email')) = ANY (
             SELECT LOWER(BTRIM(e)) FROM unnest(COALESCE(u.alternate_emails, ARRAY[]::TEXT[])) AS e
           )
      )
      -- Permission: any of the four sources of wholesale access.
      AND (
        u.role IN ('superadmin', 'admin')
        OR u.is_partner IS TRUE
        OR u.inventory_access IS TRUE
      )
  );
$$;

DO $$ BEGIN
  RAISE NOTICE 'wholesale_caller_allowed() tightened: auth_id-first identity match + inventory_access branch.';
END $$;
