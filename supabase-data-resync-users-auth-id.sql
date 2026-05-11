-- ============================================================
-- Resync public.users.auth_id with auth.users.id
--
-- Background. wholesale_caller_allowed() relies on
--   u.auth_id = auth.uid()
-- as the first identity match (more reliable than email).
-- For Max the column held a stale UUID — a different
-- auth.users.id than the one his current session uses — so RLS
-- silently rejected his storage uploads with "new row violates
-- row-level security policy" even though every other piece of
-- the setup was correct.
--
-- This UPDATE re-syncs every public.users row whose email matches
-- an auth.users row, copying the current auth.users.id into
-- public.users.auth_id. Email match is case-insensitive trimmed.
--
-- Safe to re-run; only changes rows where the column is stale.
-- ============================================================

UPDATE public.users u
SET auth_id = au.id,
    updated_at = now()
FROM auth.users au
WHERE LOWER(BTRIM(u.email)) = LOWER(BTRIM(au.email))
  AND (u.auth_id IS DISTINCT FROM au.id);

DO $$
DECLARE n BIGINT;
BEGIN
  SELECT COUNT(*) INTO n FROM public.users WHERE auth_id IS NOT NULL;
  RAISE NOTICE 'Resync complete. public.users rows with auth_id set: %.', n;
END $$;
