-- Drop the legacy `permissions` row from the `settings` table.
--
-- This row backed the old Admin Panel → Permissions tab, a buyer/admin/superadmin
-- feature matrix. The new role-management system (PRs #232–#235) replaces it
-- entirely: role_modules drives the sidebar, page guards, and write-gates, and
-- the GUI lives at Settings → 🛡️ Role Manager.
--
-- The legacy tab + the `permissions` field on AppContext were removed in this
-- PR, so this row no longer has a reader.
DELETE FROM settings WHERE key = 'permissions';
