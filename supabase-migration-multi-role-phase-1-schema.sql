-- Multi-role Phase 1: schema + helpers + backfill.
--
-- Today users.role is a single text column FK'd to roles(id). After
-- this migration, the canonical store of role assignments becomes
-- the new user_roles join table. users.role stays as a "primary
-- role" used by existing code paths and by get_my_role(); Phase 3
-- rewrites RLS policies to use the new helpers below so additional
-- roles actually grant data access.
--
-- This migration is read-only from the app's perspective:
--   - existing get_my_role() / RLS / frontend behavior is unchanged
--   - user_roles is backfilled from users.role
--   - a trigger keeps user_roles in sync with future users.role
--     updates (so existing changeRole flows continue to work)
--
-- New SQL helpers:
--   public.get_my_roles()           → text[]   all roles for the caller
--   public.has_any_role(VARIADIC text[]) → bool true if caller has any
--
-- Both honor get_effective_user_id() so impersonation continues to work.

-- ── 1. user_roles table ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id     uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role_id     text        NOT NULL REFERENCES public.roles(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  granted_by  uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON public.user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON public.user_roles(role_id);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Read: anyone authenticated. Mirrors public.users (which is
-- readable so the AdminPanel can list everyone) and keeps the
-- AdminPanel multi-role UI simple.
DROP POLICY IF EXISTS user_roles_read ON public.user_roles;
CREATE POLICY user_roles_read ON public.user_roles
  FOR SELECT TO authenticated
  USING (TRUE);

-- Write: admins/superadmins only. Mirrors existing role-edit
-- gating on users.role (handled by the AdminPanel changeRole
-- flow, which is gated client-side AND by RLS on users).
DROP POLICY IF EXISTS user_roles_write ON public.user_roles;
CREATE POLICY user_roles_write ON public.user_roles
  FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin', 'superadmin'))
  WITH CHECK (public.get_my_role() IN ('admin', 'superadmin'));

-- ── 2. Backfill from users.role ─────────────────────────────────
-- Every existing user gets one row matching their current primary
-- role. Idempotent — re-running this migration is a no-op.
INSERT INTO public.user_roles (user_id, role_id)
SELECT id, role
FROM   public.users
WHERE  role IS NOT NULL
ON CONFLICT (user_id, role_id) DO NOTHING;

-- ── 3. Sync trigger ─────────────────────────────────────────────
-- Keeps user_roles in sync with users.role. Writes to user_roles
-- on INSERT (new user record) and on UPDATE OF role (changeRole).
-- Removing a role still happens explicitly via DELETE FROM
-- user_roles — we never auto-prune the old primary because it
-- might have been pinned as an additional role intentionally.
CREATE OR REPLACE FUNCTION public.sync_user_role_to_user_roles()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NEW.role IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role_id)
    VALUES (NEW.id, NEW.role)
    ON CONFLICT (user_id, role_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_user_role_insert ON public.users;
CREATE TRIGGER trg_sync_user_role_insert
  AFTER INSERT ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_user_role_to_user_roles();

DROP TRIGGER IF EXISTS trg_sync_user_role_update ON public.users;
CREATE TRIGGER trg_sync_user_role_update
  AFTER UPDATE OF role ON public.users
  FOR EACH ROW
  WHEN (NEW.role IS DISTINCT FROM OLD.role)
  EXECUTE FUNCTION public.sync_user_role_to_user_roles();

-- ── 4. Helpers ─────────────────────────────────────────────────
-- get_my_roles() — every role assigned to the effective caller.
-- Honors impersonation via get_effective_user_id().
CREATE OR REPLACE FUNCTION public.get_my_roles()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(array_agg(role_id), ARRAY[]::text[])
  FROM   public.user_roles
  WHERE  user_id = public.get_effective_user_id();
$$;
GRANT EXECUTE ON FUNCTION public.get_my_roles() TO authenticated, anon;

-- has_any_role(...) — true if the caller has any role in the set.
-- VARIADIC so callers can write `has_any_role('admin', 'superadmin')`.
CREATE OR REPLACE FUNCTION public.has_any_role(VARIADIC roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = public.get_effective_user_id()
      AND role_id = ANY(roles)
  );
$$;
GRANT EXECUTE ON FUNCTION public.has_any_role(text[]) TO authenticated, anon;
