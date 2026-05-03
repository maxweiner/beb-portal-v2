-- Adds 'trunk-show-stores' to the role_modules CHECK enum and seeds
-- access for admin / superadmin / trunk_admin so the new sidebar entry
-- and page guard work.
--
-- Discovery-pattern drop: the constraint name has drifted across past
-- migrations, so we look it up before dropping. Idempotent.

DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE  conrelid = 'public.role_modules'::regclass
      AND  contype  = 'c'
      AND  pg_get_constraintdef(oid) ILIKE '%module_id%'
  LOOP
    EXECUTE format('ALTER TABLE public.role_modules DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE role_modules
  ADD CONSTRAINT role_modules_module_id_check
  CHECK (module_id IN (
    'dashboard', 'calendar', 'events', 'schedule', 'travel',
    'dayentry', 'staff', 'admin', 'libertyadmin', 'stores',
    'data-research', 'reports', 'financials', 'marketing',
    'shipping', 'expenses', 'recipients', 'notification-templates',
    'customers',
    'trade-shows', 'trunk-shows', 'trunk-show-stores', 'leads'
  ));

-- Seed grants. Mirror the trunk_shows module: admin / superadmin /
-- trunk_admin all get full read+write. Partners' access flows through
-- is_my_partner() in the table's RLS, not through role_modules.
--
-- Per-row WHERE EXISTS so a missing role (trunk_admin may not be
-- seeded in every environment) skips that row instead of rolling
-- back the whole statement on FK violation.
INSERT INTO role_modules (role_id, module_id)
SELECT r.id, 'trunk-show-stores'
FROM roles r
WHERE r.id IN ('admin', 'superadmin', 'trunk_admin')
ON CONFLICT (role_id, module_id) DO NOTHING;

DO $$ BEGIN
  RAISE NOTICE 'trunk-show-stores module added to role_modules CHECK; granted to admin/superadmin/trunk_admin.';
END $$;
