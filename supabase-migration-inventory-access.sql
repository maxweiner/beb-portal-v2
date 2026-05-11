-- ============================================================
-- Per-user inventory_access flag
--
-- Mirrors marketing_access (supabase-migration-marketing-phase-1-
-- schema.sql): a boolean column on users that lets a superadmin
-- grant access to the Inventory (wholesale) module independently
-- of the user's role. A user with inventory_access=true sees the
-- "Inventory Management" sidebar item and can open the module —
-- same effect as having the wholesale module granted via role.
--
-- Defaults FALSE so the rollout is opt-in. RLS on the users table
-- already allows superadmin updates (proven by the marketing_access
-- pattern in MarketingAccessPanel).
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS inventory_access BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.users.inventory_access IS
  'When true, the user can open the Inventory (wholesale) module regardless of their role. Toggle from Admin Panel → Inventory Access.';

DO $$ BEGIN
  RAISE NOTICE 'Added users.inventory_access. Default FALSE — no one is granted by default.';
END $$;
