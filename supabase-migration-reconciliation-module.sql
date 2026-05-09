-- ── Reconciliation: register sidebar nav module ────────────
--
-- The Sidebar filters every nav item against role_modules; without
-- this row the new 'reconciliation' page is invisible. Granted to
-- the same audience as the dispute / accounting work: accounting,
-- admin, superadmin. Partners get access via users.is_partner gate
-- inside the page itself + via RLS on the new tables.
--
-- Safe to re-run.
-- ============================================================

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
    'buy-intake',
    'intake-lookup',
    'reconciliation'   -- NEW: WF cleared-check reconciliation
  ));

INSERT INTO role_modules (role_id, module_id) VALUES
  ('accounting', 'reconciliation'),
  ('admin',      'reconciliation'),
  ('superadmin', 'reconciliation')
ON CONFLICT (role_id, module_id) DO NOTHING;

DO $$ BEGIN
  RAISE NOTICE 'Reconciliation nav module registered + granted to accounting/admin/superadmin. Partners get access via users.is_partner inside the page.';
END $$;
