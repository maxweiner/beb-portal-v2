-- ============================================================
-- Fix-up for PR A's role_modules seed: notification-templates was
-- granted to both admin and superadmin, but the previous RoleGuard
-- in app/page.tsx had it as superadmin-only. PR D uses ModuleGuard
-- to enforce role_modules at the page level, so without this fix
-- admins would gain access they didn't have before.
--
-- Removes admin's grant for 'notification-templates'. Superadmin
-- keeps it. Anyone who specifically wants to grant it back to
-- admin (or any other role) can do so via Settings → Role Manager.
--
-- Safe to re-run.
-- ============================================================

DELETE FROM role_modules
 WHERE role_id = 'admin' AND module_id = 'notification-templates';

DO $$ BEGIN
  RAISE NOTICE 'admin role no longer grants notification-templates module access.';
END $$;
