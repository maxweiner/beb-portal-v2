-- ============================================================
-- Customers RLS — alternate-email fix
--
-- The phase-1 customers helpers join auth.uid() against
-- public.users.email directly. That breaks for users who sign
-- in with one of their alternate_emails: auth.users.email won't
-- match users.email, the helper returns FALSE, and RLS hides
-- every row.
--
-- supabase-migration-alternate-email-auth.sql already taught
-- get_effective_user_id() to honor alternate_emails. This patch
-- re-routes the customer helpers through that function so the
-- behavior is consistent everywhere.
--
-- Safe to re-run.
-- ============================================================

-- Admin-or-superadmin check, alt-email aware.
CREATE OR REPLACE FUNCTION customers_actor_is_admin() RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.users u
     WHERE u.id = public.get_effective_user_id()
       AND u.role IN ('admin', 'superadmin')
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Buyer-event-window check, alt-email aware.
CREATE OR REPLACE FUNCTION customers_buyer_has_event_access(p_store_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  my_uid UUID;
BEGIN
  my_uid := public.get_effective_user_id();
  IF my_uid IS NULL THEN RETURN FALSE; END IF;
  RETURN EXISTS (
    SELECT 1
      FROM events e,
           jsonb_array_elements(coalesce(e.workers, '[]'::jsonb)) w
     WHERE e.store_id = p_store_id
       AND CURRENT_DATE BETWEEN e.start_date AND (e.start_date + INTERVAL '2 days')::DATE
       AND w->>'id' = my_uid::text
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
