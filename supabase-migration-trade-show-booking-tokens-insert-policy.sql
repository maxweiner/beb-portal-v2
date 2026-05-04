-- Allow trade-show owners to generate booking links from the browser.
--
-- Mirror of the trunk_show_booking_tokens fix. The original schema
-- enabled RLS on trade_show_booking_tokens with NO policies,
-- expecting the service role to be the only writer. But
-- lib/sales/tradeShowAppointments.ts generateBookingToken() runs
-- in the browser using the signed-in user's supabase client, so
-- the insert was blocked with:
--   "new row violates row-level security policy for
--    table trade_show_booking_tokens"
--
-- Mirror trade_shows write access: admin / superadmin / partner can
-- always insert. (Trade shows don't have a per-row assigned rep,
-- unlike trunk shows.) API routes touching this table use the
-- service role and bypass RLS, so no SELECT/UPDATE policies are
-- needed.
--
-- Safe to re-run.

DROP POLICY IF EXISTS trade_show_booking_tokens_insert ON trade_show_booking_tokens;
CREATE POLICY trade_show_booking_tokens_insert ON trade_show_booking_tokens
  FOR INSERT TO authenticated
  WITH CHECK (
    public.get_my_role() IN ('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
  );
