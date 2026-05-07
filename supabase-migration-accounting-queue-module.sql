-- ── Accounting Queue: nav module for the new dashboard ──────
-- One screen for the accountant: every expense report waiting on
-- review or payment, plus aging signals and bulk actions. Lives at
-- nav id 'accounting-queue'. Granted to the accounting role plus
-- admin/superadmin (so partners can also see it if they want).
--
-- Safe to re-run.
-- ============================================================

-- 1. Drop the existing role_modules CHECK constraint so we can
--    add 'accounting-queue' to the allowed module ids.
DO $$
DECLARE
  conname text;
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

-- 2. Re-add CHECK constraint with 'accounting-queue' included.
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
    'accounting-queue'  -- NEW: dedicated accountant dashboard
  ));

-- 3. Grant the new module to relevant roles.
INSERT INTO role_modules (role_id, module_id) VALUES
  ('accounting',  'accounting-queue'),
  ('admin',       'accounting-queue'),
  ('superadmin',  'accounting-queue')
ON CONFLICT (role_id, module_id) DO NOTHING;

DO $$ BEGIN
  RAISE NOTICE 'Accounting Queue module installed + granted to accounting/admin/superadmin.';
END $$;
