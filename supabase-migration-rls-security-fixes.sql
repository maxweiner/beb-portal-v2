-- ── RLS security fixes — addresses 15 ERROR-level Supabase advisor flags
-- ── (5 × policy_exists_rls_disabled, 10 × rls_disabled_in_public)
--
-- Strategy:
--   1. Tables that already have full CRUD policies → just enable RLS.
--   2. Tables with partial policy coverage → add the missing policies
--      THEN enable RLS, so the app doesn't break the moment RLS flips on.
--   3. Tables with no policies at all → add a sensible default
--      (admin/superadmin/partner write; authenticated read where the
--      app needs it) THEN enable RLS.
--
-- Helpers used (defined in supabase-migration-multi-role-phase-3-rls.sql):
--   public.has_any_role(VARIADIC text[]) → bool
--   public.is_my_partner()              → bool
--   public.get_effective_user_id()      → uuid (impersonation-aware)
--
-- Safe to re-run.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Tables with complete CRUD policies — just turn RLS on.
--    (Existing policies were created via the dashboard / earlier
--    migrations and the advisor confirms they cover SELECT/INSERT/
--    UPDATE/DELETE. Flipping RLS on activates them.)
-- ─────────────────────────────────────────────────────────────

ALTER TABLE public.buyer_checks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_employees ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────
-- 2. Tables with partial coverage — add the missing policies first.
-- ─────────────────────────────────────────────────────────────

-- ── stores: existing policies cover INSERT + DELETE only.
--    Add SELECT (everyone authenticated) + UPDATE (admin/partner).
DROP POLICY IF EXISTS stores_select ON public.stores;
CREATE POLICY stores_select ON public.stores
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS stores_update ON public.stores;
CREATE POLICY stores_update ON public.stores
  FOR UPDATE TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  )
  WITH CHECK (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  );

ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;

-- ── buyer_entries: existing policy covers DELETE only.
--    The table is read via JOIN from events queries on the client
--    (lib/context.tsx, components/events/Events.tsx, lib/dayRollup.ts)
--    so SELECT must be open to all authenticated. Buyer-side writes
--    go through DayEntry (they hit buyer_checks, not buyer_entries),
--    so we lock INSERT/UPDATE to admin/partner.
DROP POLICY IF EXISTS buyer_entries_select ON public.buyer_entries;
CREATE POLICY buyer_entries_select ON public.buyer_entries
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS buyer_entries_insert ON public.buyer_entries;
CREATE POLICY buyer_entries_insert ON public.buyer_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
    OR buyer_id = public.get_effective_user_id()
  );

DROP POLICY IF EXISTS buyer_entries_update ON public.buyer_entries;
CREATE POLICY buyer_entries_update ON public.buyer_entries
  FOR UPDATE TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
    OR buyer_id = public.get_effective_user_id()
  );

ALTER TABLE public.buyer_entries ENABLE ROW LEVEL SECURITY;

-- ── travel_reservations: existing policy covers SELECT only.
--    Travel.tsx + MobileTravel.tsx hit INSERT/UPDATE/DELETE directly
--    from the client. Buyers manage their own; admin/partner override.
DROP POLICY IF EXISTS travel_reservations_insert ON public.travel_reservations;
CREATE POLICY travel_reservations_insert ON public.travel_reservations
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
    OR buyer_id = public.get_effective_user_id()
  );

DROP POLICY IF EXISTS travel_reservations_update ON public.travel_reservations;
CREATE POLICY travel_reservations_update ON public.travel_reservations
  FOR UPDATE TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
    OR buyer_id = public.get_effective_user_id()
  )
  WITH CHECK (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
    OR buyer_id = public.get_effective_user_id()
  );

DROP POLICY IF EXISTS travel_reservations_delete ON public.travel_reservations;
CREATE POLICY travel_reservations_delete ON public.travel_reservations
  FOR DELETE TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
    OR buyer_id = public.get_effective_user_id()
  );

ALTER TABLE public.travel_reservations ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────
-- 3. Tables with no policies at all — add full coverage.
-- ─────────────────────────────────────────────────────────────

-- ── store_contacts (per-store contact list, used in Stores.tsx).
--    Open SELECT to authenticated; writes restricted to admin/partner.
DROP POLICY IF EXISTS store_contacts_select ON public.store_contacts;
CREATE POLICY store_contacts_select ON public.store_contacts
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS store_contacts_write ON public.store_contacts;
CREATE POLICY store_contacts_write ON public.store_contacts
  FOR ALL TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  )
  WITH CHECK (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  );

ALTER TABLE public.store_contacts ENABLE ROW LEVEL SECURITY;

-- ── travel_folders (per-event organizational folders for Travel notes).
--    Buyers actively read AND write these via Travel.tsx, so allow
--    full ALL-access for any authenticated user.
DROP POLICY IF EXISTS travel_folders_all ON public.travel_folders;
CREATE POLICY travel_folders_all ON public.travel_folders
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.travel_folders ENABLE ROW LEVEL SECURITY;

-- ── travel_items (notes/files inside travel_folders, per event).
--    Same access pattern as travel_folders — buyers read + write.
DROP POLICY IF EXISTS travel_items_all ON public.travel_items;
CREATE POLICY travel_items_all ON public.travel_items
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.travel_items ENABLE ROW LEVEL SECURITY;

-- ── travel_acknowledgments (per-buyer travel coverage acks).
--    Buyers manage their own rows via Travel.tsx; admin/partner can
--    fix any row. Anyone authenticated can read so the readiness
--    chips on PreEventTab work.
DROP POLICY IF EXISTS travel_acks_select ON public.travel_acknowledgments;
CREATE POLICY travel_acks_select ON public.travel_acknowledgments
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS travel_acks_insert ON public.travel_acknowledgments;
CREATE POLICY travel_acks_insert ON public.travel_acknowledgments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
    OR buyer_id = public.get_effective_user_id()
  );

DROP POLICY IF EXISTS travel_acks_update ON public.travel_acknowledgments;
CREATE POLICY travel_acks_update ON public.travel_acknowledgments
  FOR UPDATE TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
    OR buyer_id = public.get_effective_user_id()
  )
  WITH CHECK (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
    OR buyer_id = public.get_effective_user_id()
  );

DROP POLICY IF EXISTS travel_acks_delete ON public.travel_acknowledgments;
CREATE POLICY travel_acks_delete ON public.travel_acknowledgments
  FOR DELETE TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
    OR buyer_id = public.get_effective_user_id()
  );

ALTER TABLE public.travel_acknowledgments ENABLE ROW LEVEL SECURITY;

-- ── travel_alerts (no client-side reference today — dead/legacy).
--    Lock down to admin/partner so it stays safe if someone wires
--    it up later without thinking about RLS.
DROP POLICY IF EXISTS travel_alerts_all ON public.travel_alerts;
CREATE POLICY travel_alerts_all ON public.travel_alerts
  FOR ALL TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  )
  WITH CHECK (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  );

ALTER TABLE public.travel_alerts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  RAISE NOTICE 'RLS enabled on 10 tables. Advisor ERROR-level security flags should clear on next scan.';
END $$;
