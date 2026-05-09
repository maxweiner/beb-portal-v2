-- ── Intake → Purchase: register sidebar nav modules ─────────
--
-- The Sidebar filters every nav item against the role_modules table —
-- if a module_id isn't granted to the user's role, the item never
-- renders. We added two sidebar entries (🪪 Buy Intake + Buy Form
-- Lookup) but never registered them in role_modules, so they don't
-- appear for anyone.
--
-- This migration:
--   1. Adds 'buy-intake' + 'intake-lookup' to the role_modules
--      CHECK constraint.
--   2. Grants both to every role that today has 'buying-events'
--      (anyone who works a buying event needs to capture intakes).
--   3. Grants both to admin + superadmin explicitly.
--
-- Safe to re-run.
-- ============================================================

-- 1. Drop the existing CHECK constraint (name varies across migrations).
DO $$
DECLARE conname text;
BEGIN
  SELECT c.conname INTO conname
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'role_modules' AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%module_id%';
  IF conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE role_modules DROP CONSTRAINT %I', conname);
  END IF;
END $$;

-- 2. Re-add CHECK with the two new module IDs.
ALTER TABLE role_modules ADD CONSTRAINT role_modules_module_id_check
  CHECK (module_id IN (
    'dashboard',
    'appointments', 'buying-events', 'calendar', 'travel', 'dayentry',
    'buying-event-stores',
    'trade-shows', 'trunk-shows', 'trunk-show-stores',
    'trunk-communications', 'leads',
    'marketing', 'shipping', 'expenses', 'reports', 'customers',
    'admin', 'liberty-admin',
    'staff', 'data-research', 'financials',
    'recipients', 'notification-templates',
    'accounting-queue',
    'broadcast',
    'buy-intake',     -- NEW: photo-first buy-form capture
    'intake-lookup'   -- NEW: search across every intake ever logged
  ));

-- 3. Grant 'buy-intake' to every role that already has 'buying-events'
--    (the people who actually work events at the counter).
INSERT INTO role_modules (role_id, module_id)
SELECT DISTINCT role_id, 'buy-intake'
FROM role_modules
WHERE module_id = 'buying-events'
ON CONFLICT (role_id, module_id) DO NOTHING;

-- 4. Grant 'intake-lookup' to admin + superadmin only — it's a
--    cross-event search tool that surfaces other people's intakes.
--    Buyers can find their own from the Hub worksheet.
INSERT INTO role_modules (role_id, module_id) VALUES
  ('admin',      'intake-lookup'),
  ('superadmin', 'intake-lookup'),
  ('admin',      'buy-intake'),       -- belt-and-suspenders in case
  ('superadmin', 'buy-intake')        -- the buying-events join above
ON CONFLICT (role_id, module_id) DO NOTHING;  -- missed an admin role.

DO $$ BEGIN
  RAISE NOTICE 'Intake nav modules registered: buy-intake, intake-lookup.';
END $$;
