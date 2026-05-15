-- ============================================================
-- Wholesale RLS — let inventory_access users in
--
-- The original wholesale_caller_allowed() helper gates every
-- wholesale-module table (inventory_items, photos, memos,
-- invoices, customers, etc.) on:
--
--   role IN ('superadmin', 'admin') OR is_partner IS TRUE
--
-- But WholesalePage.tsx ALSO grants access to users with
-- `inventory_access = TRUE` — a per-user flag the superadmin
-- toggles in Admin Panel → Inventory Access for ops staff that
-- aren't admins / partners. Those users could OPEN the module
-- (UI gate passes) but couldn't READ any of its rows (DB gate
-- blocked). Symptom: blank tabs everywhere on mobile + desktop.
--
-- Same pattern as how marketing_access works for the marketing
-- surface — we mirror that here.
--
-- While we're in there, drop the brittle
-- `u.email = auth.jwt()->>'email'` pattern in favor of the
-- canonical helpers (has_any_role / is_my_partner /
-- get_effective_user_id). Per the site-wide RLS tightening from
-- PR #582 (2026-05-12), new code must use these — they're
-- auth_id-first and resilient to alternate-email setups, case
-- differences, etc.
--
-- Safe to re-run. Idempotent.
-- ============================================================

CREATE OR REPLACE FUNCTION public.wholesale_caller_allowed()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Three independent paths, any one passes:
  --   1. has_any_role('admin', 'superadmin') — the role-based grant
  --   2. is_my_partner() — partners get full access
  --   3. users.inventory_access = TRUE — per-user opt-in flag
  --
  -- All three resolve the actor via get_effective_user_id() under
  -- the hood, which is auth_id-first. No raw-email comparison.
  SELECT
       public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
    OR EXISTS (
         SELECT 1 FROM public.users u
         WHERE u.id = public.get_effective_user_id()
           AND u.inventory_access IS TRUE
       );
$$;

COMMENT ON FUNCTION public.wholesale_caller_allowed() IS
  'RLS gate for every wholesale-module table. Passes when the caller is admin/superadmin OR is_partner OR has users.inventory_access=true. Auth_id-first via the helper trio (has_any_role / is_my_partner / get_effective_user_id) — no raw-email match.';

GRANT EXECUTE ON FUNCTION public.wholesale_caller_allowed() TO authenticated, anon;

DO $$ BEGIN
  RAISE NOTICE 'wholesale_caller_allowed() updated — inventory_access users can now read wholesale tables.';
END $$;
