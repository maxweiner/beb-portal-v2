-- ── Seed the trunk_admin role + module grants ────────────────
-- The role has been referenced by RLS policies (multi-role
-- phase 3, trunk-show-stores module, trunk-communications
-- module) and by the new dashboard reminders widget, but the
-- row was never inserted into the roles table — it was a
-- "ghost role" no user could actually be assigned to.
--
-- This migration:
--   1. Inserts the trunk_admin row in `roles` (idempotent).
--   2. Seeds role_modules grants so users with this role see
--      the right left-nav entries: dashboard + the entire
--      selling section + trunk communications. Buying-side
--      modules (events, dayentry, expenses, financials,
--      marketing, shipping) intentionally excluded — admins
--      can grant additional modules per-role via the Role
--      Manager UI in Settings.
--
-- Role definition: trunk_admin manages trunk shows operationally
-- but isn't a system-wide admin. Different from sales_rep in
-- that the existing has_any_role('admin','superadmin','trunk_admin')
-- RLS policies treat trunk_admin as full read/write on trunk
-- show data — sales_rep has narrower per-row scoping.
--
-- Safe to re-run.
-- ============================================================

INSERT INTO public.roles (id, label, description, is_system)
VALUES (
  'trunk_admin',
  'Trunk Admin',
  'Operational manager for trunk shows. Full read/write on trunk_shows, trunk_show_stores, special requests, communications. Not a system-wide admin.',
  TRUE
)
ON CONFLICT (id) DO NOTHING;

-- Module grants. Mirrors sales_rep's selling-section access plus
-- dashboard. RLS gives them admin-level write power on trunk-show
-- tables; module_id grants only control sidebar visibility +
-- page-level guards.
INSERT INTO public.role_modules (role_id, module_id) VALUES
  ('trunk_admin', 'dashboard'),
  ('trunk_admin', 'trade-shows'),
  ('trunk_admin', 'trunk-shows'),
  ('trunk_admin', 'trunk-show-stores'),
  ('trunk_admin', 'leads'),
  ('trunk_admin', 'trunk-communications'),
  ('trunk_admin', 'staff')
ON CONFLICT (role_id, module_id) DO NOTHING;

DO $$ BEGIN
  RAISE NOTICE 'trunk_admin role seeded with dashboard + selling-section + trunk-communications + staff modules.';
END $$;
