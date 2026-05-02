-- ============================================================
-- Bug fix: To-Do RLS rejects list creation when the JWT email
-- differs in case from `users.email`, or when the user signed in
-- with one of their `users.alternate_emails` rather than the
-- primary.
--
-- Symptom:
--   "new row violates row-level security policy for table todo_lists"
-- when calling createList(). The INSERT policy checks
--   owner_id = todo_current_user_id()
-- and the helper currently does an exact case-sensitive match,
-- so a JWT email like "max.weiner@gmail.com" fails to find a row
-- whose users.email is "Max.Weiner@gmail.com" — and never checks
-- alternate_emails at all. The helper returns NULL and the policy
-- rejects every INSERT/UPDATE/DELETE.
--
-- Fix: lookup is case-insensitive AND also matches against
-- users.alternate_emails. Mirrors how the rest of the app's
-- email-based lookups behave.
--
-- Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION todo_current_user_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  WITH jwt_email AS (
    SELECT LOWER(auth.jwt() ->> 'email') AS e
  )
  SELECT u.id
    FROM users u, jwt_email j
   WHERE j.e IS NOT NULL
     AND (
       LOWER(u.email) = j.e
       OR EXISTS (
         SELECT 1
           FROM unnest(COALESCE(u.alternate_emails, ARRAY[]::text[])) AS ae
          WHERE LOWER(ae) = j.e
       )
     )
   LIMIT 1
$$;

DO $$ BEGIN
  RAISE NOTICE 'todo_current_user_id() upgraded to case-insensitive + alternate_emails matching.';
END $$;
