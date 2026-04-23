-- ============================================================
-- Simplify Enter Day Data: single-form, day-level model.
-- Everyone on an event's workers array can now enter/edit data
-- for that day, writing directly to event_days. Checks stay in
-- buyer_checks but become day-level (no entry_id, keyed by
-- event_id + day_number).
--
-- Run in the Supabase SQL Editor. Idempotent.
-- ============================================================

-- 1. Make entry_id nullable so day-level checks (no buyer_entry) can exist.
ALTER TABLE buyer_checks ALTER COLUMN entry_id DROP NOT NULL;

-- 2. Add day_number on buyer_checks for direct event+day lookup.
ALTER TABLE buyer_checks ADD COLUMN IF NOT EXISTS day_number integer;

-- 3. Permissive RLS on event_days so any authenticated user can
--    read/write. Frontend handles access gating by filtering the
--    event dropdown to workers+admins.
DROP POLICY IF EXISTS "days_select" ON event_days;
DROP POLICY IF EXISTS "days_insert" ON event_days;
DROP POLICY IF EXISTS "days_update" ON event_days;
DROP POLICY IF EXISTS "days_delete" ON event_days;

CREATE POLICY "days_select" ON event_days
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "days_insert" ON event_days
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "days_update" ON event_days
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- 4. Permissive RLS on buyer_checks too.
DROP POLICY IF EXISTS "checks_select" ON buyer_checks;
DROP POLICY IF EXISTS "checks_insert" ON buyer_checks;
DROP POLICY IF EXISTS "checks_update" ON buyer_checks;
DROP POLICY IF EXISTS "checks_delete" ON buyer_checks;

CREATE POLICY "checks_select" ON buyer_checks
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "checks_insert" ON buyer_checks
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "checks_update" ON buyer_checks
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "checks_delete" ON buyer_checks
  FOR DELETE TO authenticated USING (true);

-- 5. Index to keep (event_id, day_number) lookups on buyer_checks fast.
CREATE INDEX IF NOT EXISTS idx_buyer_checks_event_day
  ON buyer_checks(event_id, day_number) WHERE entry_id IS NULL;

-- 6. DO NOT drop buyer_entries or legacy buyer_checks rows.
--    They stay intact for historical display/rollup.
