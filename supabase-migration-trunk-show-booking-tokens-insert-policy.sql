-- Allow trunk-show owners to generate booking links from the browser.
--
-- The original schema (sales-rep phase 1) enabled RLS on
-- trunk_show_booking_tokens with NO policies, intending the service
-- role to be the only writer. But lib/sales/trunkShowAppointments.ts
-- generateBookingToken() runs in the browser using the signed-in
-- user's supabase client, so the insert was being blocked with
-- "new row violates row-level security policy".
--
-- Mirror the trunk_shows write policy: admin / superadmin /
-- trunk_admin / partner can always insert; a sales_rep can insert
-- for shows they're the assigned rep on. API routes that touch this
-- table use the service role and bypass RLS, so no SELECT/UPDATE
-- policies are needed.
--
-- Safe to re-run.

DROP POLICY IF EXISTS trunk_show_booking_tokens_insert ON trunk_show_booking_tokens;
CREATE POLICY trunk_show_booking_tokens_insert ON trunk_show_booking_tokens
  FOR INSERT TO authenticated
  WITH CHECK (
    public.get_my_role() IN ('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
    OR EXISTS (
      SELECT 1 FROM trunk_shows ts
       WHERE ts.id = trunk_show_id
         AND ts.assigned_rep_id = public.get_effective_user_id()
    )
  );
