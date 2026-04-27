-- ============================================================
-- Diagnose + fix the events DELETE RLS policy.
--
-- Symptom: clicking Delete Event in AdminPanel returns no error
-- and shows the success toast, but the event reappears after
-- reload. Cause: Supabase RLS silently filters out the DELETE
-- when no matching policy permits it (no error, just 0 rows
-- affected).
--
-- Run sections in order. The first SELECT shows what policies
-- currently exist on events; the second block creates a
-- superadmin DELETE policy idempotently.
-- ============================================================

-- 1. DIAGNOSTIC — list current RLS policies on events
SELECT policyname, cmd, roles, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'events'
ORDER BY cmd, policyname;

-- 2. FIX — superadmin can delete events
-- (Re-runnable: drops the policy first if it already exists.)
DROP POLICY IF EXISTS "Superadmins delete events" ON events;
CREATE POLICY "Superadmins delete events"
  ON events FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.email = auth.jwt()->>'email'
        AND u.role = 'superadmin'
    )
  );

-- 3. While we're here — ensure the manual cascade tables also
-- allow superadmin DELETE (otherwise they silently no-op too,
-- and once we add proper FKs would block the events delete).
DROP POLICY IF EXISTS "Superadmins delete buyer_checks" ON buyer_checks;
CREATE POLICY "Superadmins delete buyer_checks"
  ON buyer_checks FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role = 'superadmin'));

DROP POLICY IF EXISTS "Superadmins delete buyer_entries" ON buyer_entries;
CREATE POLICY "Superadmins delete buyer_entries"
  ON buyer_entries FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role = 'superadmin'));

DROP POLICY IF EXISTS "Superadmins delete event_days" ON event_days;
CREATE POLICY "Superadmins delete event_days"
  ON event_days FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users u WHERE u.email = auth.jwt()->>'email' AND u.role = 'superadmin'));

-- 4. VERIFY — re-run section 1 to confirm the new policies are present.
