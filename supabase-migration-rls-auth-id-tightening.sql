-- ============================================================
-- Site-wide RLS auth-id tightening
--
-- Background
-- ----------
-- Multiple RLS policies in this app match the caller by comparing
-- `users.email = auth.jwt()->>'email'`. That pattern silently denies
-- users whose Supabase Auth login email doesn't exactly equal their
-- public.users.email row — either because of case drift OR because
-- the user signed in with one of their `alternate_emails`.
--
-- Concrete symptom we've been hitting:
--   - Teri logs in with teriwelsch@gmail.com (her auth.users.email)
--   - Her public.users.email is teri@bebllp.com
--   - Inserts on `stores` (and elsewhere) fail with:
--       "new row violates row-level security policy"
--
-- The wholesale module and marketing module each got their own
-- targeted fixes (`wholesale_caller_allowed()` tighten + the
-- marketing-access-alt-emails migration). This migration brings the
-- same robustness to the rest of the app, one shot.
--
-- Strategy
-- --------
-- 1. **Tighten the kingmaker helper, `get_effective_user_id()`.**
--    Most modern policies route through this (directly, or via the
--    `get_my_role()` / `has_any_role()` / `is_my_partner()` chain).
--    Adding `auth_id = auth.uid()` as the FIRST match path silently
--    fixes every policy that already composes this helper — no
--    per-policy edits needed.
--
-- 2. **Tighten the one remaining brittle helper, `is_trunk_comms_admin()`.**
--    Rewrites it to use the tightened helpers instead of an inline
--    email match. Picks up the auth_id fix automatically.
--
-- 3. **Add the missing `stores` INSERT + DELETE policies** with the
--    proper helper-based gates. The select/update policies already
--    use helpers — INSERT and DELETE were defined elsewhere (likely
--    via the Supabase Dashboard at project setup) on the brittle
--    email pattern, which is what Teri is currently failing on.
--
-- 4. **Drop + recreate the highest-traffic inline brittle policies**
--    using helper-based identity. Touches: appointments, store
--    booking config, QR codes, shipping, GCal sync, notifications,
--    data research, event waitlist, accounting expense view,
--    trunk comms / trunk-show GCal, welcome-email-log, customer
--    intakes, marketing payments, pre-event readiness, report
--    templates, buying-event spiffs.
--
-- Naming + idempotency
-- --------------------
-- Every section uses `DROP POLICY IF EXISTS ... CREATE POLICY ...`
-- with the same policy names as the original migrations so this is
-- a clean overwrite. Safe to re-run.
--
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. Tighten public.get_effective_user_id()
-- ─────────────────────────────────────────────────────────────
--
-- Adds auth_id-first matching. Old behaviour (case-insensitive
-- primary + alternate_emails) stays as fallback for rows where
-- auth_id was never backfilled.
--
-- Impersonation still wins (the COALESCE-NULLIF on the JWT claim
-- is preserved verbatim).
CREATE OR REPLACE FUNCTION public.get_effective_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    NULLIF(auth.jwt() ->> 'impersonating_user_id', '')::uuid,
    (
      SELECT id FROM public.users
      WHERE auth_id = auth.uid()
         OR LOWER(BTRIM(email)) = LOWER(BTRIM(auth.jwt() ->> 'email'))
         OR EXISTS (
              SELECT 1
              FROM   unnest(COALESCE(alternate_emails, ARRAY[]::TEXT[])) AS alt(addr)
              WHERE  LOWER(BTRIM(alt.addr)) = LOWER(BTRIM(auth.jwt() ->> 'email'))
            )
      LIMIT 1
    )
  );
$$;
GRANT EXECUTE ON FUNCTION public.get_effective_user_id() TO authenticated, anon;


-- ─────────────────────────────────────────────────────────────
-- 2. Tighten is_trunk_comms_admin()
-- ─────────────────────────────────────────────────────────────
--
-- Reroute through `has_any_role()` + `is_my_partner()` so the
-- auth_id-first identity match cascades for free.
CREATE OR REPLACE FUNCTION public.is_trunk_comms_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role('admin','superadmin')
      OR public.is_my_partner();
$$;
GRANT EXECUTE ON FUNCTION public.is_trunk_comms_admin() TO authenticated;


-- ─────────────────────────────────────────────────────────────
-- 3. Stores: add missing INSERT + DELETE policies (Teri's bug)
-- ─────────────────────────────────────────────────────────────
--
-- The select/update policies already use helpers (per
-- supabase-migration-rls-security-fixes.sql). Insert + delete were
-- created elsewhere on the brittle email pattern, which is what
-- Teri is hitting today. Overwrite them with the proper helpers.
DROP POLICY IF EXISTS stores_insert ON public.stores;
CREATE POLICY stores_insert ON public.stores
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  );

DROP POLICY IF EXISTS stores_delete ON public.stores;
CREATE POLICY stores_delete ON public.stores
  FOR DELETE TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  );


-- ─────────────────────────────────────────────────────────────
-- 4. Inline brittle policy rewrites (per module)
-- ─────────────────────────────────────────────────────────────
--
-- For every table below, drop + recreate each policy that
-- previously did `EXISTS (SELECT 1 FROM users u WHERE
-- u.email = auth.jwt()->>'email' AND ...)`. The replacement uses
-- `has_any_role()` and/or `is_my_partner()` — both compose the
-- tightened `get_effective_user_id()` so identity is now
-- auth_id-first.
--
-- Ownership clauses (e.g. `OR u.id = expense_reports.user_id`)
-- become `OR public.get_effective_user_id() = <ownership_column>`.

-- 4.1 Appointments module ───────────────────────────────────────
DROP POLICY IF EXISTS "Admins manage event_booking_overrides" ON public.event_booking_overrides;
CREATE POLICY "Admins manage event_booking_overrides"
  ON public.event_booking_overrides FOR ALL TO authenticated
  USING (public.has_any_role('admin', 'superadmin'))
  WITH CHECK (public.has_any_role('admin', 'superadmin'));

DROP POLICY IF EXISTS "Admins manage slot_blocks" ON public.slot_blocks;
CREATE POLICY "Admins manage slot_blocks"
  ON public.slot_blocks FOR ALL TO authenticated
  USING (public.has_any_role('admin', 'superadmin'))
  WITH CHECK (public.has_any_role('admin', 'superadmin'));

DROP POLICY IF EXISTS "Admins manage appointments" ON public.appointments;
CREATE POLICY "Admins manage appointments"
  ON public.appointments FOR ALL TO authenticated
  USING (public.has_any_role('admin', 'superadmin'))
  WITH CHECK (public.has_any_role('admin', 'superadmin'));

DROP POLICY IF EXISTS "Admins read notification_log" ON public.notification_log;
CREATE POLICY "Admins read notification_log"
  ON public.notification_log FOR SELECT TO authenticated
  USING (public.has_any_role('admin', 'superadmin'));

DROP POLICY IF EXISTS "Admins read hot_show_alerts" ON public.hot_show_alerts;
CREATE POLICY "Admins read hot_show_alerts"
  ON public.hot_show_alerts FOR SELECT TO authenticated
  USING (public.has_any_role('admin', 'superadmin'));

-- 4.2 Store booking config ──────────────────────────────────────
DROP POLICY IF EXISTS "Admins manage booking_config" ON public.booking_config;
CREATE POLICY "Admins manage booking_config"
  ON public.booking_config FOR ALL TO authenticated
  USING (public.has_any_role('admin', 'superadmin'))
  WITH CHECK (public.has_any_role('admin', 'superadmin'));

DROP POLICY IF EXISTS "Admins manage appointment_employees" ON public.appointment_employees;
CREATE POLICY "Admins manage appointment_employees"
  ON public.appointment_employees FOR ALL TO authenticated
  USING (public.has_any_role('admin', 'superadmin'))
  WITH CHECK (public.has_any_role('admin', 'superadmin'));

DROP POLICY IF EXISTS "Admins manage store_portal_tokens" ON public.store_portal_tokens;
CREATE POLICY "Admins manage store_portal_tokens"
  ON public.store_portal_tokens FOR ALL TO authenticated
  USING (public.has_any_role('admin', 'superadmin'))
  WITH CHECK (public.has_any_role('admin', 'superadmin'));

-- 4.3 QR codes ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins manage store_groups" ON public.store_groups;
CREATE POLICY "Admins manage store_groups"
  ON public.store_groups FOR ALL TO authenticated
  USING (public.has_any_role('admin', 'superadmin'))
  WITH CHECK (public.has_any_role('admin', 'superadmin'));

DROP POLICY IF EXISTS "Admins manage store_group_members" ON public.store_group_members;
CREATE POLICY "Admins manage store_group_members"
  ON public.store_group_members FOR ALL TO authenticated
  USING (public.has_any_role('admin', 'superadmin'))
  WITH CHECK (public.has_any_role('admin', 'superadmin'));

DROP POLICY IF EXISTS "Admins manage qr_codes" ON public.qr_codes;
CREATE POLICY "Admins manage qr_codes"
  ON public.qr_codes FOR ALL TO authenticated
  USING (public.has_any_role('admin', 'superadmin'))
  WITH CHECK (public.has_any_role('admin', 'superadmin'));

DROP POLICY IF EXISTS "Admins read qr_scans" ON public.qr_scans;
CREATE POLICY "Admins read qr_scans"
  ON public.qr_scans FOR SELECT TO authenticated
  USING (public.has_any_role('admin', 'superadmin'));

-- 4.4 GCal sync ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins read gcal_integration_settings" ON public.gcal_integration_settings;
CREATE POLICY "Admins read gcal_integration_settings"
  ON public.gcal_integration_settings FOR SELECT TO authenticated
  USING (public.has_any_role('admin', 'superadmin'));

DROP POLICY IF EXISTS "Superadmins write gcal_integration_settings" ON public.gcal_integration_settings;
CREATE POLICY "Superadmins write gcal_integration_settings"
  ON public.gcal_integration_settings FOR ALL TO authenticated
  USING (public.has_any_role('superadmin'))
  WITH CHECK (public.has_any_role('superadmin'));

DROP POLICY IF EXISTS "Admins read gcal_event_links" ON public.gcal_event_links;
CREATE POLICY "Admins read gcal_event_links"
  ON public.gcal_event_links FOR SELECT TO authenticated
  USING (public.has_any_role('admin', 'superadmin'));

DROP POLICY IF EXISTS "Admins read gcal_sync_queue" ON public.gcal_sync_queue;
CREATE POLICY "Admins read gcal_sync_queue"
  ON public.gcal_sync_queue FOR SELECT TO authenticated
  USING (public.has_any_role('admin', 'superadmin'));

-- 4.5 Trunk-show GCal sync ──────────────────────────────────────
DROP POLICY IF EXISTS "Admins read trunk_show_gcal_event_links" ON public.trunk_show_gcal_event_links;
CREATE POLICY "Admins read trunk_show_gcal_event_links"
  ON public.trunk_show_gcal_event_links FOR SELECT TO authenticated
  USING (public.has_any_role('admin', 'superadmin'));

DROP POLICY IF EXISTS "Admins read trunk_show_gcal_sync_queue" ON public.trunk_show_gcal_sync_queue;
CREATE POLICY "Admins read trunk_show_gcal_sync_queue"
  ON public.trunk_show_gcal_sync_queue FOR SELECT TO authenticated
  USING (public.has_any_role('admin', 'superadmin'));

-- 4.6 Notifications ─────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins read notification_queue" ON public.notification_queue;
CREATE POLICY "Admins read notification_queue"
  ON public.notification_queue FOR SELECT TO authenticated
  USING (public.has_any_role('admin', 'superadmin'));

DROP POLICY IF EXISTS "Admins read notification_templates" ON public.notification_templates;
CREATE POLICY "Admins read notification_templates"
  ON public.notification_templates FOR SELECT TO authenticated
  USING (public.has_any_role('admin', 'superadmin'));

DROP POLICY IF EXISTS "Superadmins write notification_templates" ON public.notification_templates;
CREATE POLICY "Superadmins write notification_templates"
  ON public.notification_templates FOR ALL TO authenticated
  USING (public.has_any_role('superadmin'))
  WITH CHECK (public.has_any_role('superadmin'));

DROP POLICY IF EXISTS "Admins read scheduled_notifications" ON public.scheduled_notifications;
CREATE POLICY "Admins read scheduled_notifications"
  ON public.scheduled_notifications FOR SELECT TO authenticated
  USING (public.has_any_role('admin', 'superadmin'));

DROP POLICY IF EXISTS "Superadmins write scheduled_notifications" ON public.scheduled_notifications;
CREATE POLICY "Superadmins write scheduled_notifications"
  ON public.scheduled_notifications FOR ALL TO authenticated
  USING (public.has_any_role('superadmin'))
  WITH CHECK (public.has_any_role('superadmin'));

DROP POLICY IF EXISTS "Admins read notification_settings" ON public.notification_settings;
CREATE POLICY "Admins read notification_settings"
  ON public.notification_settings FOR SELECT TO authenticated
  USING (public.has_any_role('admin', 'superadmin'));

DROP POLICY IF EXISTS "Superadmins write notification_settings" ON public.notification_settings;
CREATE POLICY "Superadmins write notification_settings"
  ON public.notification_settings FOR ALL TO authenticated
  USING (public.has_any_role('superadmin'))
  WITH CHECK (public.has_any_role('superadmin'));

-- 4.7 Data research / QR campaign sends ─────────────────────────
DROP POLICY IF EXISTS "Admins read qr_campaign_sends" ON public.qr_campaign_sends;
CREATE POLICY "Admins read qr_campaign_sends"
  ON public.qr_campaign_sends FOR SELECT TO authenticated
  USING (public.has_any_role('admin', 'superadmin'));

DROP POLICY IF EXISTS "Superadmins write qr_campaign_sends" ON public.qr_campaign_sends;
CREATE POLICY "Superadmins write qr_campaign_sends"
  ON public.qr_campaign_sends FOR ALL TO authenticated
  USING (public.has_any_role('superadmin'))
  WITH CHECK (public.has_any_role('superadmin'));

-- 4.8 Event waitlist ────────────────────────────────────────────
-- select + insert are open to authenticated (any user can join a
-- waitlist); update + delete are admin/partner.
DROP POLICY IF EXISTS "event_waitlist_delete" ON public.event_waitlist;
CREATE POLICY "event_waitlist_delete"
  ON public.event_waitlist FOR DELETE TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  );

-- 4.9 Accounting view-all-expenses ──────────────────────────────
-- These select policies replace the originals (in expenses-pr1) +
-- the override added in accounting-view-all-expenses.sql, which
-- broadened access to the 'accounting' role.
DROP POLICY IF EXISTS expense_reports_select ON public.expense_reports;
CREATE POLICY expense_reports_select
  ON public.expense_reports FOR SELECT TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin', 'accounting')
    OR public.get_effective_user_id() = user_id
  );

DROP POLICY IF EXISTS expenses_select ON public.expenses;
CREATE POLICY expenses_select
  ON public.expenses FOR SELECT TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin', 'accounting')
    OR EXISTS (
      SELECT 1 FROM public.expense_reports r
      WHERE r.id = expenses.expense_report_id
        AND r.user_id = public.get_effective_user_id()
    )
  );

-- 4.10 Expenses pr1 schema (the rest) ───────────────────────────
DROP POLICY IF EXISTS buyer_rates_select ON public.buyer_rates;
CREATE POLICY buyer_rates_select
  ON public.buyer_rates FOR SELECT TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR public.get_effective_user_id() = user_id
  );

DROP POLICY IF EXISTS buyer_rates_manage ON public.buyer_rates;
CREATE POLICY buyer_rates_manage
  ON public.buyer_rates FOR ALL TO authenticated
  USING (public.has_any_role('admin', 'superadmin'))
  WITH CHECK (public.has_any_role('admin', 'superadmin'));

DROP POLICY IF EXISTS expense_reports_insert ON public.expense_reports;
CREATE POLICY expense_reports_insert
  ON public.expense_reports FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role('admin', 'superadmin')
    OR user_id = public.get_effective_user_id()
  );

DROP POLICY IF EXISTS expense_reports_update ON public.expense_reports;
CREATE POLICY expense_reports_update
  ON public.expense_reports FOR UPDATE TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR user_id = public.get_effective_user_id()
  )
  WITH CHECK (
    public.has_any_role('admin', 'superadmin')
    OR user_id = public.get_effective_user_id()
  );

DROP POLICY IF EXISTS expense_reports_delete ON public.expense_reports;
CREATE POLICY expense_reports_delete
  ON public.expense_reports FOR DELETE TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR user_id = public.get_effective_user_id()
  );

DROP POLICY IF EXISTS expenses_insert ON public.expenses;
CREATE POLICY expenses_insert
  ON public.expenses FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role('admin', 'superadmin')
    OR EXISTS (
      SELECT 1 FROM public.expense_reports r
      WHERE r.id = expense_report_id
        AND r.user_id = public.get_effective_user_id()
    )
  );

DROP POLICY IF EXISTS expenses_update ON public.expenses;
CREATE POLICY expenses_update
  ON public.expenses FOR UPDATE TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR EXISTS (
      SELECT 1 FROM public.expense_reports r
      WHERE r.id = expenses.expense_report_id
        AND r.user_id = public.get_effective_user_id()
    )
  )
  WITH CHECK (
    public.has_any_role('admin', 'superadmin')
    OR EXISTS (
      SELECT 1 FROM public.expense_reports r
      WHERE r.id = expenses.expense_report_id
        AND r.user_id = public.get_effective_user_id()
    )
  );

DROP POLICY IF EXISTS expenses_delete ON public.expenses;
CREATE POLICY expenses_delete
  ON public.expenses FOR DELETE TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR EXISTS (
      SELECT 1 FROM public.expense_reports r
      WHERE r.id = expenses.expense_report_id
        AND r.user_id = public.get_effective_user_id()
    )
  );

DROP POLICY IF EXISTS compensation_invoices_select ON public.compensation_invoices;
CREATE POLICY compensation_invoices_select
  ON public.compensation_invoices FOR SELECT TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin', 'accounting')
    OR public.get_effective_user_id() = user_id
  );

DROP POLICY IF EXISTS compensation_invoices_insert ON public.compensation_invoices;
CREATE POLICY compensation_invoices_insert
  ON public.compensation_invoices FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role('admin', 'superadmin'));

DROP POLICY IF EXISTS compensation_invoices_update ON public.compensation_invoices;
CREATE POLICY compensation_invoices_update
  ON public.compensation_invoices FOR UPDATE TO authenticated
  USING (public.has_any_role('admin', 'superadmin'))
  WITH CHECK (public.has_any_role('admin', 'superadmin'));

DROP POLICY IF EXISTS compensation_invoices_delete ON public.compensation_invoices;
CREATE POLICY compensation_invoices_delete
  ON public.compensation_invoices FOR DELETE TO authenticated
  USING (public.has_any_role('admin', 'superadmin'));

DROP POLICY IF EXISTS compensation_line_items_select ON public.compensation_line_items;
CREATE POLICY compensation_line_items_select
  ON public.compensation_line_items FOR SELECT TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin', 'accounting')
    OR EXISTS (
      SELECT 1 FROM public.compensation_invoices ci
      WHERE ci.id = compensation_line_items.compensation_invoice_id
        AND ci.user_id = public.get_effective_user_id()
    )
  );

-- 4.11 Expense report templates ─────────────────────────────────
DROP POLICY IF EXISTS templates_select ON public.expense_report_templates;
CREATE POLICY templates_select
  ON public.expense_report_templates FOR SELECT TO authenticated
  USING (true);  -- previously gated on JWT email being non-null;
                  -- now any authenticated user can read templates.

DROP POLICY IF EXISTS templates_manage ON public.expense_report_templates;
CREATE POLICY templates_manage
  ON public.expense_report_templates FOR ALL TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  )
  WITH CHECK (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  );

-- 4.12 Shipping (manifests + manifests-event-scope) ─────────────
DROP POLICY IF EXISTS shipping_manifests_read ON public.shipping_manifests;
CREATE POLICY shipping_manifests_read
  ON public.shipping_manifests FOR SELECT TO authenticated
  USING (true);  -- previously any authenticated; preserve.

DROP POLICY IF EXISTS shipping_manifests_insert ON public.shipping_manifests;
CREATE POLICY shipping_manifests_insert
  ON public.shipping_manifests FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
    OR created_by = public.get_effective_user_id()
  );

DROP POLICY IF EXISTS shipping_manifests_update ON public.shipping_manifests;
CREATE POLICY shipping_manifests_update
  ON public.shipping_manifests FOR UPDATE TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
    OR created_by = public.get_effective_user_id()
  )
  WITH CHECK (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
    OR created_by = public.get_effective_user_id()
  );

-- 4.13 Shipping pr1 (event shipments + boxes) ───────────────────
DROP POLICY IF EXISTS shipments_read ON public.event_shipments;
CREATE POLICY shipments_read
  ON public.event_shipments FOR SELECT TO authenticated
  USING (true);  -- previously any authenticated.

DROP POLICY IF EXISTS shipments_manage ON public.event_shipments;
CREATE POLICY shipments_manage
  ON public.event_shipments FOR ALL TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  )
  WITH CHECK (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  );

DROP POLICY IF EXISTS boxes_read ON public.event_shipment_boxes;
CREATE POLICY boxes_read
  ON public.event_shipment_boxes FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS boxes_manage ON public.event_shipment_boxes;
CREATE POLICY boxes_manage
  ON public.event_shipment_boxes FOR ALL TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  )
  WITH CHECK (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  );

-- 4.14 Customer intakes ─────────────────────────────────────────
DROP POLICY IF EXISTS "Buyers can insert intakes for their events" ON public.customer_intakes;
CREATE POLICY "Buyers can insert intakes for their events"
  ON public.customer_intakes FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role('admin', 'superadmin')
    OR buyer_id = public.get_effective_user_id()
  );

DROP POLICY IF EXISTS "Buyers can read own intakes" ON public.customer_intakes;
CREATE POLICY "Buyers can read own intakes"
  ON public.customer_intakes FOR SELECT TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR buyer_id = public.get_effective_user_id()
  );

DROP POLICY IF EXISTS "Buyers can update own intakes" ON public.customer_intakes;
CREATE POLICY "Buyers can update own intakes"
  ON public.customer_intakes FOR UPDATE TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR buyer_id = public.get_effective_user_id()
  )
  WITH CHECK (
    public.has_any_role('admin', 'superadmin')
    OR buyer_id = public.get_effective_user_id()
  );

DROP POLICY IF EXISTS "Admins can delete intakes" ON public.customer_intakes;
CREATE POLICY "Admins can delete intakes"
  ON public.customer_intakes FOR DELETE TO authenticated
  USING (public.has_any_role('admin', 'superadmin'));

-- 4.15 Marketing payments ───────────────────────────────────────
DROP POLICY IF EXISTS "Admins read methods" ON public.marketing_payment_methods;
CREATE POLICY "Admins read methods"
  ON public.marketing_payment_methods FOR SELECT TO authenticated
  USING (public.has_any_role('admin', 'superadmin'));

DROP POLICY IF EXISTS "Superadmins write methods" ON public.marketing_payment_methods;
CREATE POLICY "Superadmins write methods"
  ON public.marketing_payment_methods FOR ALL TO authenticated
  USING (public.has_any_role('superadmin'))
  WITH CHECK (public.has_any_role('superadmin'));

DROP POLICY IF EXISTS "Admins read types" ON public.marketing_payment_types;
CREATE POLICY "Admins read types"
  ON public.marketing_payment_types FOR SELECT TO authenticated
  USING (public.has_any_role('admin', 'superadmin'));

DROP POLICY IF EXISTS "Superadmins write types" ON public.marketing_payment_types;
CREATE POLICY "Superadmins write types"
  ON public.marketing_payment_types FOR ALL TO authenticated
  USING (public.has_any_role('superadmin'))
  WITH CHECK (public.has_any_role('superadmin'));

DROP POLICY IF EXISTS "Admins manage marketing_payments" ON public.marketing_payments;
CREATE POLICY "Admins manage marketing_payments"
  ON public.marketing_payments FOR ALL TO authenticated
  USING (public.has_any_role('admin', 'superadmin'))
  WITH CHECK (public.has_any_role('admin', 'superadmin'));

-- 4.16 Pre-event readiness ──────────────────────────────────────
DROP POLICY IF EXISTS "promo_asset_orders_select" ON public.event_promotional_asset_orders;
CREATE POLICY "promo_asset_orders_select"
  ON public.event_promotional_asset_orders FOR SELECT TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  );

DROP POLICY IF EXISTS "promo_asset_orders_write" ON public.event_promotional_asset_orders;
CREATE POLICY "promo_asset_orders_write"
  ON public.event_promotional_asset_orders FOR ALL TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  )
  WITH CHECK (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  );

-- 4.17 Buying-event spiffs ──────────────────────────────────────
DROP POLICY IF EXISTS "buying_event_spiff_payouts_select" ON public.buying_event_spiff_payouts;
CREATE POLICY "buying_event_spiff_payouts_select"
  ON public.buying_event_spiff_payouts FOR SELECT TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
    OR buyer_id = public.get_effective_user_id()
  );

DROP POLICY IF EXISTS "buying_event_spiff_payouts_partner_write" ON public.buying_event_spiff_payouts;
CREATE POLICY "buying_event_spiff_payouts_partner_write"
  ON public.buying_event_spiff_payouts FOR ALL TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  )
  WITH CHECK (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  );

-- 4.18 Welcome email log ────────────────────────────────────────
DROP POLICY IF EXISTS "Admins manage welcome_email_log" ON public.welcome_email_log;
CREATE POLICY "Admins manage welcome_email_log"
  ON public.welcome_email_log FOR ALL TO authenticated
  USING (public.has_any_role('admin', 'superadmin'))
  WITH CHECK (public.has_any_role('admin', 'superadmin'));

-- 4.19 Report templates ─────────────────────────────────────────
DROP POLICY IF EXISTS "Admins manage report_templates" ON public.report_templates;
CREATE POLICY "Admins manage report_templates"
  ON public.report_templates FOR ALL TO authenticated
  USING (public.has_any_role('admin', 'superadmin'))
  WITH CHECK (public.has_any_role('admin', 'superadmin'));

-- 4.20 Reports v1 ───────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins read custom_reports" ON public.custom_reports;
CREATE POLICY "Admins read custom_reports"
  ON public.custom_reports FOR SELECT TO authenticated
  USING (public.has_any_role('admin', 'superadmin'));

DROP POLICY IF EXISTS "Creators and superadmins write custom_reports" ON public.custom_reports;
CREATE POLICY "Creators and superadmins write custom_reports"
  ON public.custom_reports FOR ALL TO authenticated
  USING (
    public.has_any_role('superadmin')
    OR created_by = public.get_effective_user_id()
  )
  WITH CHECK (
    public.has_any_role('superadmin')
    OR created_by = public.get_effective_user_id()
  );

DROP POLICY IF EXISTS "Users manage own custom_report_pins" ON public.custom_report_pins;
CREATE POLICY "Users manage own custom_report_pins"
  ON public.custom_report_pins FOR ALL TO authenticated
  USING (user_id = public.get_effective_user_id())
  WITH CHECK (user_id = public.get_effective_user_id());

-- 4.21 Trunk-comms phase 1 ──────────────────────────────────────
-- All of these previously gated through is_trunk_comms_admin()'s
-- brittle inline check OR a duplicated inline pattern. The
-- function is now tightened (Section 2 above), so calls to it
-- here are robust. Recreated explicitly for clarity.
DROP POLICY IF EXISTS "comm_templates_select" ON public.communication_templates;
CREATE POLICY "comm_templates_select"
  ON public.communication_templates FOR SELECT TO authenticated
  USING (public.is_trunk_comms_admin());

DROP POLICY IF EXISTS "comm_templates_write" ON public.communication_templates;
CREATE POLICY "comm_templates_write"
  ON public.communication_templates FOR ALL TO authenticated
  USING (public.is_trunk_comms_admin())
  WITH CHECK (public.is_trunk_comms_admin());

DROP POLICY IF EXISTS "comm_schedules_select" ON public.communication_send_schedules;
CREATE POLICY "comm_schedules_select"
  ON public.communication_send_schedules FOR SELECT TO authenticated
  USING (public.is_trunk_comms_admin());

DROP POLICY IF EXISTS "comm_schedules_write" ON public.communication_send_schedules;
CREATE POLICY "comm_schedules_write"
  ON public.communication_send_schedules FOR ALL TO authenticated
  USING (public.is_trunk_comms_admin())
  WITH CHECK (public.is_trunk_comms_admin());

DROP POLICY IF EXISTS "comm_sends_select" ON public.communication_sends;
CREATE POLICY "comm_sends_select"
  ON public.communication_sends FOR SELECT TO authenticated
  USING (public.is_trunk_comms_admin());

DROP POLICY IF EXISTS "comm_sends_insert" ON public.communication_sends;
CREATE POLICY "comm_sends_insert"
  ON public.communication_sends FOR INSERT TO authenticated
  WITH CHECK (public.is_trunk_comms_admin());

DROP POLICY IF EXISTS "comm_sends_update" ON public.communication_sends;
CREATE POLICY "comm_sends_update"
  ON public.communication_sends FOR UPDATE TO authenticated
  USING (public.is_trunk_comms_admin())
  WITH CHECK (public.is_trunk_comms_admin());

DROP POLICY IF EXISTS "checklist_master_select" ON public.trunk_show_checklist_master;
CREATE POLICY "checklist_master_select"
  ON public.trunk_show_checklist_master FOR SELECT TO authenticated
  USING (public.is_trunk_comms_admin());

DROP POLICY IF EXISTS "checklist_master_write" ON public.trunk_show_checklist_master;
CREATE POLICY "checklist_master_write"
  ON public.trunk_show_checklist_master FOR ALL TO authenticated
  USING (public.is_trunk_comms_admin())
  WITH CHECK (public.is_trunk_comms_admin());

DROP POLICY IF EXISTS "checklist_items_select" ON public.trunk_show_checklist_items;
CREATE POLICY "checklist_items_select"
  ON public.trunk_show_checklist_items FOR SELECT TO authenticated
  USING (public.is_trunk_comms_admin());

DROP POLICY IF EXISTS "checklist_items_write" ON public.trunk_show_checklist_items;
CREATE POLICY "checklist_items_write"
  ON public.trunk_show_checklist_items FOR ALL TO authenticated
  USING (public.is_trunk_comms_admin())
  WITH CHECK (public.is_trunk_comms_admin());

-- ─────────────────────────────────────────────────────────────
-- Done. Brief NOTICE on completion so the Dashboard SQL editor
-- shows it loaded.
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  RAISE NOTICE 'RLS auth-id tightening complete: get_effective_user_id() now matches by auth_id FIRST, falling back to case-insensitive primary email and alternate_emails. ~60 inline brittle policies rewritten to use helper-based identity. Stores INSERT/DELETE policies added.';
END $$;
