-- ============================================================
-- Fix: events_delete policy excluded superadmins.
--
-- Existing policy: get_my_role() = 'admin'
-- New policy:      get_my_role() IN ('admin', 'superadmin')
--
-- Same fix applied to the three cascade-target tables that
-- AdminPanel.handleDelete sweeps before deleting the event row.
-- If those tables' DELETE policies are also admin-only, the
-- manual cascade silently no-ops and the events DELETE then
-- fails on FK constraints (also silent under RLS).
--
-- Re-runnable.
-- ============================================================

-- 1. events
DROP POLICY IF EXISTS events_delete ON events;
CREATE POLICY events_delete ON events FOR DELETE TO public
  USING (get_my_role() IN ('admin', 'superadmin'));

-- 2. cascade-target tables — grant superadmin DELETE if not present.
--    Using DROP IF EXISTS + CREATE so we don't conflict with whatever
--    is already there.
DROP POLICY IF EXISTS buyer_checks_delete_admins  ON buyer_checks;
CREATE POLICY buyer_checks_delete_admins  ON buyer_checks  FOR DELETE TO public
  USING (get_my_role() IN ('admin', 'superadmin'));

DROP POLICY IF EXISTS buyer_entries_delete_admins ON buyer_entries;
CREATE POLICY buyer_entries_delete_admins ON buyer_entries FOR DELETE TO public
  USING (get_my_role() IN ('admin', 'superadmin'));

DROP POLICY IF EXISTS event_days_delete_admins    ON event_days;
CREATE POLICY event_days_delete_admins    ON event_days    FOR DELETE TO public
  USING (get_my_role() IN ('admin', 'superadmin'));

-- 3. Also clean up the over-permissive layered policies my first
--    attempt added (if they're there). Harmless if absent.
DROP POLICY IF EXISTS "Superadmins delete events"        ON events;
DROP POLICY IF EXISTS "Superadmins delete buyer_checks"  ON buyer_checks;
DROP POLICY IF EXISTS "Superadmins delete buyer_entries" ON buyer_entries;
DROP POLICY IF EXISTS "Superadmins delete event_days"    ON event_days;

-- 4. Verify
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('events', 'buyer_checks', 'buyer_entries', 'event_days')
  AND cmd = 'DELETE'
ORDER BY tablename, policyname;
