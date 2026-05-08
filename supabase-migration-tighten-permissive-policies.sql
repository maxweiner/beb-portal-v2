-- ── Tighten the 15 always-true RLS policies flagged by the advisor
--
-- Each replaced policy now scopes by ownership (user_id / id /
-- buyer-on-event) plus an admin/superadmin/partner override. The
-- existing service-role API routes are unaffected — service role
-- bypasses RLS entirely.
--
-- New helper: public.is_buyer_on_event(uuid) — boolean. Returns true
-- when the caller's effective user_id appears in the event's
-- jsonb workers array. Used by buyer_checks / event_days / travel_*
-- policies so buyers can write only the events they're working.
--
-- Deletes the dashboard-created always-true policies on `users`
-- (admins can insert users, admins can update users); the existing
-- users_admin_insert / users_admin_update from the multi-role
-- migrations already cover the admin path, with the proper
-- has_any_role check.
--
-- Safe to re-run.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 0. Helper function: is_buyer_on_event
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_buyer_on_event(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.events e,
         jsonb_array_elements(coalesce(e.workers, '[]'::jsonb)) w
    WHERE e.id = p_event_id
      AND (w->>'id')::uuid = public.get_effective_user_id()
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_buyer_on_event(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.is_buyer_on_event(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 1. buyer_checks — admin/partner OR buyer-on-event
-- ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS checks_insert ON public.buyer_checks;
CREATE POLICY checks_insert ON public.buyer_checks
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
    OR public.is_buyer_on_event(event_id)
  );

DROP POLICY IF EXISTS checks_update ON public.buyer_checks;
CREATE POLICY checks_update ON public.buyer_checks
  FOR UPDATE TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
    OR public.is_buyer_on_event(event_id)
  )
  WITH CHECK (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
    OR public.is_buyer_on_event(event_id)
  );

DROP POLICY IF EXISTS checks_delete ON public.buyer_checks;
CREATE POLICY checks_delete ON public.buyer_checks
  FOR DELETE TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
    OR public.is_buyer_on_event(event_id)
  );

-- ─────────────────────────────────────────────────────────────
-- 2. buyer_vacations — self-only writes
-- ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can insert own vacations" ON public.buyer_vacations;
CREATE POLICY "Users can insert own vacations" ON public.buyer_vacations
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = public.get_effective_user_id()
    OR public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  );

DROP POLICY IF EXISTS "Users can delete own vacations" ON public.buyer_vacations;
CREATE POLICY "Users can delete own vacations" ON public.buyer_vacations
  FOR DELETE TO authenticated
  USING (
    user_id = public.get_effective_user_id()
    OR public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  );

-- ─────────────────────────────────────────────────────────────
-- 3. event_days — admin/partner OR buyer-on-event
-- ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS days_insert ON public.event_days;
CREATE POLICY days_insert ON public.event_days
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
    OR public.is_buyer_on_event(event_id)
  );

DROP POLICY IF EXISTS days_update ON public.event_days;
CREATE POLICY days_update ON public.event_days
  FOR UPDATE TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
    OR public.is_buyer_on_event(event_id)
  )
  WITH CHECK (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
    OR public.is_buyer_on_event(event_id)
  );

-- ─────────────────────────────────────────────────────────────
-- 4. event_notes — split open SELECT + scoped writes
-- ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Allow all for authenticated" ON public.event_notes;

DROP POLICY IF EXISTS event_notes_select ON public.event_notes;
CREATE POLICY event_notes_select ON public.event_notes
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS event_notes_write ON public.event_notes;
CREATE POLICY event_notes_write ON public.event_notes
  FOR ALL TO authenticated
  USING (
    user_id = public.get_effective_user_id()
    OR public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  )
  WITH CHECK (
    user_id = public.get_effective_user_id()
    OR public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  );

-- ─────────────────────────────────────────────────────────────
-- 5. event_waitlist — admin/partner-only writes
-- ─────────────────────────────────────────────────────────────
-- The public booking form goes through a service-role API route, so
-- locking authenticated writes to admin/partner here is safe.

DROP POLICY IF EXISTS event_waitlist_insert ON public.event_waitlist;
CREATE POLICY event_waitlist_insert ON public.event_waitlist
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  );

DROP POLICY IF EXISTS event_waitlist_update ON public.event_waitlist;
CREATE POLICY event_waitlist_update ON public.event_waitlist
  FOR UPDATE TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  )
  WITH CHECK (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  );

-- ─────────────────────────────────────────────────────────────
-- 6. receipt_scans — own-row writes + admin/partner override
-- ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Authenticated users can insert receipt scans" ON public.receipt_scans;
DROP POLICY IF EXISTS receipt_scans_insert ON public.receipt_scans;
CREATE POLICY receipt_scans_insert ON public.receipt_scans
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = public.get_effective_user_id()
    OR public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  );

DROP POLICY IF EXISTS "Authenticated users can update receipt scans" ON public.receipt_scans;
DROP POLICY IF EXISTS receipt_scans_update ON public.receipt_scans;
CREATE POLICY receipt_scans_update ON public.receipt_scans
  FOR UPDATE TO authenticated
  USING (
    user_id = public.get_effective_user_id()
    OR public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  )
  WITH CHECK (
    user_id = public.get_effective_user_id()
    OR public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  );

DROP POLICY IF EXISTS "Authenticated users can delete receipt scans" ON public.receipt_scans;
DROP POLICY IF EXISTS receipt_scans_delete ON public.receipt_scans;
CREATE POLICY receipt_scans_delete ON public.receipt_scans
  FOR DELETE TO authenticated
  USING (
    user_id = public.get_effective_user_id()
    OR public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  );

-- ─────────────────────────────────────────────────────────────
-- 7. travel_folders / travel_items — split open SELECT + scoped writes
-- ─────────────────────────────────────────────────────────────
-- The Travel module on PreEventTab needs everyone authenticated to
-- read (so chips render); buyer-on-event scopes who can write.

DROP POLICY IF EXISTS travel_folders_all ON public.travel_folders;

DROP POLICY IF EXISTS travel_folders_select ON public.travel_folders;
CREATE POLICY travel_folders_select ON public.travel_folders
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS travel_folders_write ON public.travel_folders;
CREATE POLICY travel_folders_write ON public.travel_folders
  FOR ALL TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
    OR public.is_buyer_on_event(event_id)
  )
  WITH CHECK (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
    OR public.is_buyer_on_event(event_id)
  );

DROP POLICY IF EXISTS travel_items_all ON public.travel_items;

DROP POLICY IF EXISTS travel_items_select ON public.travel_items;
CREATE POLICY travel_items_select ON public.travel_items
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS travel_items_write ON public.travel_items;
CREATE POLICY travel_items_write ON public.travel_items
  FOR ALL TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
    OR public.is_buyer_on_event(event_id)
  )
  WITH CHECK (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
    OR public.is_buyer_on_event(event_id)
  );

-- ─────────────────────────────────────────────────────────────
-- 8. users — drop dashboard-created always-true policies; keep
--    proper users_admin_insert / users_admin_update from the
--    multi-role migrations; replace users_update with a self-row
--    scope so Settings → profile edits keep working.
-- ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "admins can insert users" ON public.users;
DROP POLICY IF EXISTS "admins can update users" ON public.users;

DROP POLICY IF EXISTS users_update ON public.users;
CREATE POLICY users_update ON public.users
  FOR UPDATE TO authenticated
  USING (
    id = public.get_effective_user_id()
    OR public.has_any_role('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
  )
  WITH CHECK (
    id = public.get_effective_user_id()
    OR public.has_any_role('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
  );

DO $$ BEGIN
  RAISE NOTICE 'Always-true RLS policies tightened on 8 tables. New helper: is_buyer_on_event(uuid).';
END $$;
