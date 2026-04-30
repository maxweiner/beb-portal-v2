-- ============================================================
-- Role-management schema (PR A of the roles GUI initiative).
--
-- Today every role/module gate is hardcoded in JS (Sidebar.tsx,
-- RoleGuard, app/page.tsx redirects). This migration introduces the
-- DB-side source of truth so a Settings → Role Manager GUI can
-- create new roles and toggle module access per role.
--
-- This PR is SCHEMA ONLY. No code reads from these tables yet — the
-- sidebar + page guards still use their hardcoded checks. PRs B/C/D
-- in the series add the GUI, sidebar wiring, and page-level guards.
--
-- Data model:
--   roles            — buyer/admin/superadmin/pending/marketing/accounting
--                      seeded as is_system=TRUE (cannot be deleted via GUI).
--                      New custom roles can be added with is_system=FALSE.
--   role_modules     — (role_id, module_id) presence grants access to that
--                      module. Module list is a CHECK constraint because
--                      modules are tied to actual code (adding one needs
--                      a migration anyway).
--
-- Per-user flags (is_partner, liberty_access, marketing_access) stay as
-- per-user flags — they're orthogonal to role. The sidebar in PR C will
-- compute: effective_modules = role_modules[user.role] ∪ user-flag bonuses.
--
-- Write access is gated to max@bebll.com via RLS for now; superadmin role
-- is intentionally excluded so role-changes can't be made unless max is
-- the actor. Read access is open to all authenticated users.
--
-- Safe to re-run.
-- ============================================================

-- ── 1. roles table ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roles (
  id          TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  description TEXT NULL,
  is_system   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE roles IS
  'App-level roles. is_system=TRUE rows are protected — the GUI cannot delete or rename them.';

-- Seed today's roles. Re-runs update label/description but never flip
-- is_system off.
INSERT INTO roles (id, label, description, is_system) VALUES
  ('pending',    'Pending',    'Awaiting role assignment by an admin.', TRUE),
  ('buyer',      'Buyer',      'Day-to-day buyer with access to scheduled events.', TRUE),
  ('admin',      'Admin',      'Manages users, stores, and most operational data.', TRUE),
  ('superadmin', 'Superadmin', 'All admin powers plus system-level controls.', TRUE),
  ('marketing',  'Marketing',  'Marketing team — Calendar + Marketing module.', TRUE),
  ('accounting', 'Accounting', 'Accounting team — Calendar + Travel + Staff + Expenses.', TRUE)
ON CONFLICT (id) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  is_system = TRUE,
  updated_at = now();

-- ── 2. Replace users.role CHECK with a FK to roles ──────────
-- Drops every CHECK constraint on users.role (names vary across migrations)
-- and replaces it with a FK so user.role values must come from the roles table.
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE  conrelid = 'public.users'::regclass
      AND  contype  = 'c'
      AND  pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE public.users DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass AND conname = 'users_role_fk'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_role_fk
      FOREIGN KEY (role) REFERENCES roles(id)
      ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
END $$;

-- ── 3. role_modules table ──────────────────────────────────
-- Module IDs match the NavPage union in app/page.tsx so the sidebar can
-- look up access by exactly the same key it already uses for nav clicks.
-- 'settings' is intentionally excluded — every signed-in user can manage
-- their own profile via the gear icon, regardless of role.
CREATE TABLE IF NOT EXISTS role_modules (
  role_id    TEXT NOT NULL REFERENCES roles(id) ON UPDATE CASCADE ON DELETE CASCADE,
  module_id  TEXT NOT NULL CHECK (module_id IN (
    'dashboard', 'calendar', 'events', 'schedule', 'travel',
    'dayentry', 'staff', 'admin', 'libertyadmin', 'stores',
    'data-research', 'reports', 'financials', 'marketing',
    'shipping', 'expenses', 'todo', 'recipients', 'notification-templates'
  )),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  PRIMARY KEY (role_id, module_id)
);
CREATE INDEX IF NOT EXISTS idx_role_modules_role ON role_modules(role_id);
COMMENT ON TABLE role_modules IS
  'Per-role module access. Presence of a (role_id, module_id) row grants the role access to that module. Driven by the Role Manager GUI in Settings.';

-- ── 4. Seed role_modules to mirror today's hardcoded behavior ──
-- buyer: BEB_NAV minus adminOnly + minus partnerOnly (financials).
-- admin/superadmin: BEB_NAV including adminOnly, minus partnerOnly.
-- marketing: calendar + marketing only.
-- accounting: calendar + travel + staff + expenses.
-- pending: nothing — they're locked out until promoted.
INSERT INTO role_modules (role_id, module_id) VALUES
  -- Buyer
  ('buyer', 'dashboard'),
  ('buyer', 'calendar'),
  ('buyer', 'events'),
  ('buyer', 'schedule'),
  ('buyer', 'travel'),
  ('buyer', 'dayentry'),
  ('buyer', 'staff'),
  ('buyer', 'reports'),
  ('buyer', 'marketing'),
  ('buyer', 'shipping'),
  ('buyer', 'expenses'),
  ('buyer', 'todo'),
  -- Admin (everything buyer has + admin-only)
  ('admin', 'dashboard'),
  ('admin', 'calendar'),
  ('admin', 'events'),
  ('admin', 'schedule'),
  ('admin', 'travel'),
  ('admin', 'dayentry'),
  ('admin', 'staff'),
  ('admin', 'reports'),
  ('admin', 'marketing'),
  ('admin', 'shipping'),
  ('admin', 'expenses'),
  ('admin', 'todo'),
  ('admin', 'admin'),
  ('admin', 'libertyadmin'),
  ('admin', 'stores'),
  ('admin', 'data-research'),
  ('admin', 'recipients'),
  ('admin', 'notification-templates'),
  -- Superadmin (same as admin today; per-feature superadmin checks
  -- live inside individual pages, not at sidebar level)
  ('superadmin', 'dashboard'),
  ('superadmin', 'calendar'),
  ('superadmin', 'events'),
  ('superadmin', 'schedule'),
  ('superadmin', 'travel'),
  ('superadmin', 'dayentry'),
  ('superadmin', 'staff'),
  ('superadmin', 'reports'),
  ('superadmin', 'marketing'),
  ('superadmin', 'shipping'),
  ('superadmin', 'expenses'),
  ('superadmin', 'todo'),
  ('superadmin', 'admin'),
  ('superadmin', 'libertyadmin'),
  ('superadmin', 'stores'),
  ('superadmin', 'data-research'),
  ('superadmin', 'recipients'),
  ('superadmin', 'notification-templates'),
  -- Marketing
  ('marketing', 'calendar'),
  ('marketing', 'marketing'),
  -- Accounting
  ('accounting', 'calendar'),
  ('accounting', 'travel'),
  ('accounting', 'staff'),
  ('accounting', 'expenses')
ON CONFLICT (role_id, module_id) DO NOTHING;

-- ── 5. updated_at trigger on roles ──────────────────────────
CREATE OR REPLACE FUNCTION roles_set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_roles_updated_at ON roles;
CREATE TRIGGER trg_roles_updated_at BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION roles_set_updated_at();

-- ── 6. RLS ──────────────────────────────────────────────────
ALTER TABLE roles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_modules  ENABLE ROW LEVEL SECURITY;

-- SELECT: any authenticated user (sidebar reads role_modules to render nav).
DROP POLICY IF EXISTS roles_read_all ON roles;
CREATE POLICY roles_read_all ON roles
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS role_modules_read_all ON role_modules;
CREATE POLICY role_modules_read_all ON role_modules
  FOR SELECT USING (auth.role() = 'authenticated');

-- WRITE: gated to max@bebll.com only for now. Wrap in a helper so we
-- have one place to relax this later (e.g., add a per-user "role admin"
-- flag, or open it to superadmin).
CREATE OR REPLACE FUNCTION can_manage_roles() RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = auth.uid()
      AND lower(email) = 'max@bebll.com'
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;
COMMENT ON FUNCTION can_manage_roles() IS
  'Returns true if the current actor is allowed to manage the role table + role_modules. Currently hardcoded to max@bebll.com — intentionally narrow per the GUI initiative spec.';

DROP POLICY IF EXISTS roles_write_role_admin ON roles;
CREATE POLICY roles_write_role_admin ON roles
  FOR ALL USING (can_manage_roles()) WITH CHECK (can_manage_roles());

DROP POLICY IF EXISTS role_modules_write_role_admin ON role_modules;
CREATE POLICY role_modules_write_role_admin ON role_modules
  FOR ALL USING (can_manage_roles()) WITH CHECK (can_manage_roles());

DO $$ BEGIN
  RAISE NOTICE 'Role-management schema installed. Read-only for now — PRs B/C/D wire up the GUI + sidebar + page guards.';
END $$;
