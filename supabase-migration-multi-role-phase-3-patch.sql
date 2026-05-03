-- Phase 3 follow-up: 9 core-table policies the bulk Phase 3 migration
-- missed (their bodies live in older base migrations not in the working
-- tree). All 9 share the same pattern:
--   USING/WITH CHECK (get_my_role() = 'admin')
-- which is also a latent bug — it silently denies superadmins. The
-- rewrite both:
--   1. Switches to has_any_role(...) so secondary roles count
--   2. Adds 'superadmin' to the role list so superadmins aren't denied

-- ── event_days.days_delete ──────────────────────────────────────
DROP POLICY IF EXISTS days_delete ON public.event_days;
CREATE POLICY days_delete ON public.event_days
  FOR DELETE TO public
  USING (public.has_any_role('admin', 'superadmin'));

-- ── notifications.notif_read ────────────────────────────────────
DROP POLICY IF EXISTS notif_read ON public.notifications;
CREATE POLICY notif_read ON public.notifications
  FOR SELECT TO public
  USING (public.has_any_role('admin', 'superadmin'));

-- ── reports.report_read ─────────────────────────────────────────
DROP POLICY IF EXISTS report_read ON public.reports;
CREATE POLICY report_read ON public.reports
  FOR SELECT TO public
  USING (public.has_any_role('admin', 'superadmin'));

-- ── settings.settings_read ──────────────────────────────────────
DROP POLICY IF EXISTS settings_read ON public.settings;
CREATE POLICY settings_read ON public.settings
  FOR SELECT TO public
  USING (public.has_any_role('admin', 'superadmin'));

-- ── settings.settings_write ─────────────────────────────────────
DROP POLICY IF EXISTS settings_write ON public.settings;
CREATE POLICY settings_write ON public.settings
  FOR ALL TO public
  USING (public.has_any_role('admin', 'superadmin'));

-- ── shipments.ship_delete ───────────────────────────────────────
DROP POLICY IF EXISTS ship_delete ON public.shipments;
CREATE POLICY ship_delete ON public.shipments
  FOR DELETE TO public
  USING (public.has_any_role('admin', 'superadmin'));

-- ── users.users_admin_insert ────────────────────────────────────
DROP POLICY IF EXISTS users_admin_insert ON public.users;
CREATE POLICY users_admin_insert ON public.users
  FOR INSERT TO public
  WITH CHECK (public.has_any_role('admin', 'superadmin'));

-- ── users.users_admin_update ────────────────────────────────────
DROP POLICY IF EXISTS users_admin_update ON public.users;
CREATE POLICY users_admin_update ON public.users
  FOR UPDATE TO public
  USING (public.has_any_role('admin', 'superadmin'));

-- ── users.users_delete ──────────────────────────────────────────
DROP POLICY IF EXISTS users_delete ON public.users;
CREATE POLICY users_delete ON public.users
  FOR DELETE TO public
  USING (public.has_any_role('admin', 'superadmin'));

-- ── Sanity: surface anything still using get_my_role() ──────────
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM   pg_policies
    WHERE  schemaname = 'public'
      AND  (qual ILIKE '%get_my_role()%' OR with_check ILIKE '%get_my_role()%')
  LOOP
    RAISE NOTICE 'STILL USES get_my_role(): %.% policy=%', r.schemaname, r.tablename, r.policyname;
  END LOOP;
END $$;
