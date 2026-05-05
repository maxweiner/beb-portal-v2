-- Adds 'trunk-communications' to the role_modules CHECK enum and
-- seeds access for the roles who can see the new sidebar entry:
--   • admin / superadmin / partner — full template + schedule
--     management; the feature gate is admin-or-partner inside the
--     component itself.
--   • sales_rep — read-only on templates and schedules; can send
--     letters from their own assigned trunk shows. Must see the
--     sidebar entry.
--   • trunk_admin — same as admin (full management).
--
-- Partners' access flows through is_partner — they typically also
-- carry role=superadmin or admin, so the seeded grants below cover
-- them. If a partner has role=buyer (rare), the page guard inside
-- the component still admits them via is_partner check.
--
-- Discovery-pattern drop on the constraint name: it has drifted
-- across past migrations, so we look it up before dropping.
-- Idempotent.

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

ALTER TABLE public.role_modules
  ADD CONSTRAINT role_modules_module_id_check
  CHECK (module_id IN (
    'dashboard', 'calendar', 'events', 'schedule', 'travel',
    'dayentry', 'staff', 'admin', 'libertyadmin', 'stores',
    'data-research', 'reports', 'financials', 'marketing',
    'shipping', 'expenses', 'recipients', 'notification-templates',
    'customers',
    'trade-shows', 'trunk-shows', 'trunk-show-stores', 'leads',
    'trunk-communications'
  ));

INSERT INTO public.role_modules (role_id, module_id)
SELECT r.id, 'trunk-communications'
FROM public.roles r
WHERE r.id IN ('admin', 'superadmin', 'sales_rep', 'trunk_admin')
ON CONFLICT (role_id, module_id) DO NOTHING;

DO $$ BEGIN
  RAISE NOTICE 'trunk-communications module added; granted to admin/superadmin/sales_rep/trunk_admin.';
END $$;
