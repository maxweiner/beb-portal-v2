-- ============================================================
-- Site-wide RLS auth-id tightening — V2 (defensive)
--
-- Re-run of supabase-migration-rls-auth-id-tightening.sql, this
-- time with `to_regclass()` guards so it skips any table that
-- doesn't exist in this database. (V1 failed at the first table
-- whose migration was planned but never applied — e.g.,
-- appointment_employees.)
--
-- Sections 1–3 of V1 (the central helpers + stores INSERT/DELETE)
-- were already applied successfully; this file repeats them
-- defensively so a clean re-run is always safe.
--
-- IDEMPOTENT. Safe to re-run.
--
-- See supabase-migration-rls-auth-id-tightening.sql for the full
-- rationale. The behaviour is identical; only the wrapping changes.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. Tighten public.get_effective_user_id()
-- ─────────────────────────────────────────────────────────────
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
DO $$ BEGIN
  IF to_regprocedure('public.has_any_role(text[])') IS NOT NULL
     AND to_regprocedure('public.is_my_partner()') IS NOT NULL THEN
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION public.is_trunk_comms_admin()
      RETURNS BOOLEAN
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $body$
        SELECT public.has_any_role('admin','superadmin')
            OR public.is_my_partner();
      $body$;
    $f$;
    GRANT EXECUTE ON FUNCTION public.is_trunk_comms_admin() TO authenticated;
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────
-- 3. Stores: INSERT + DELETE (Teri's bug)
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF to_regclass('public.stores') IS NOT NULL THEN
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
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────
-- 4. Inline brittle policy rewrites — each block guarded
--    so missing tables are simply skipped.
-- ─────────────────────────────────────────────────────────────

-- 4.1 Appointments module
DO $$ BEGIN
  IF to_regclass('public.event_booking_overrides') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins manage event_booking_overrides" ON public.event_booking_overrides;
    CREATE POLICY "Admins manage event_booking_overrides"
      ON public.event_booking_overrides FOR ALL TO authenticated
      USING (public.has_any_role('admin', 'superadmin'))
      WITH CHECK (public.has_any_role('admin', 'superadmin'));
  END IF;
  IF to_regclass('public.slot_blocks') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins manage slot_blocks" ON public.slot_blocks;
    CREATE POLICY "Admins manage slot_blocks"
      ON public.slot_blocks FOR ALL TO authenticated
      USING (public.has_any_role('admin', 'superadmin'))
      WITH CHECK (public.has_any_role('admin', 'superadmin'));
  END IF;
  IF to_regclass('public.appointments') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins manage appointments" ON public.appointments;
    CREATE POLICY "Admins manage appointments"
      ON public.appointments FOR ALL TO authenticated
      USING (public.has_any_role('admin', 'superadmin'))
      WITH CHECK (public.has_any_role('admin', 'superadmin'));
  END IF;
  IF to_regclass('public.notification_log') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins read notification_log" ON public.notification_log;
    CREATE POLICY "Admins read notification_log"
      ON public.notification_log FOR SELECT TO authenticated
      USING (public.has_any_role('admin', 'superadmin'));
  END IF;
  IF to_regclass('public.hot_show_alerts') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins read hot_show_alerts" ON public.hot_show_alerts;
    CREATE POLICY "Admins read hot_show_alerts"
      ON public.hot_show_alerts FOR SELECT TO authenticated
      USING (public.has_any_role('admin', 'superadmin'));
  END IF;
END $$;

-- 4.2 Store booking config
DO $$ BEGIN
  IF to_regclass('public.booking_config') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins manage booking_config" ON public.booking_config;
    CREATE POLICY "Admins manage booking_config"
      ON public.booking_config FOR ALL TO authenticated
      USING (public.has_any_role('admin', 'superadmin'))
      WITH CHECK (public.has_any_role('admin', 'superadmin'));
  END IF;
  IF to_regclass('public.appointment_employees') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins manage appointment_employees" ON public.appointment_employees;
    CREATE POLICY "Admins manage appointment_employees"
      ON public.appointment_employees FOR ALL TO authenticated
      USING (public.has_any_role('admin', 'superadmin'))
      WITH CHECK (public.has_any_role('admin', 'superadmin'));
  END IF;
  IF to_regclass('public.store_portal_tokens') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins manage store_portal_tokens" ON public.store_portal_tokens;
    CREATE POLICY "Admins manage store_portal_tokens"
      ON public.store_portal_tokens FOR ALL TO authenticated
      USING (public.has_any_role('admin', 'superadmin'))
      WITH CHECK (public.has_any_role('admin', 'superadmin'));
  END IF;
END $$;

-- 4.3 QR codes
DO $$ BEGIN
  IF to_regclass('public.store_groups') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins manage store_groups" ON public.store_groups;
    CREATE POLICY "Admins manage store_groups"
      ON public.store_groups FOR ALL TO authenticated
      USING (public.has_any_role('admin', 'superadmin'))
      WITH CHECK (public.has_any_role('admin', 'superadmin'));
  END IF;
  IF to_regclass('public.store_group_members') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins manage store_group_members" ON public.store_group_members;
    CREATE POLICY "Admins manage store_group_members"
      ON public.store_group_members FOR ALL TO authenticated
      USING (public.has_any_role('admin', 'superadmin'))
      WITH CHECK (public.has_any_role('admin', 'superadmin'));
  END IF;
  IF to_regclass('public.qr_codes') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins manage qr_codes" ON public.qr_codes;
    CREATE POLICY "Admins manage qr_codes"
      ON public.qr_codes FOR ALL TO authenticated
      USING (public.has_any_role('admin', 'superadmin'))
      WITH CHECK (public.has_any_role('admin', 'superadmin'));
  END IF;
  IF to_regclass('public.qr_scans') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins read qr_scans" ON public.qr_scans;
    CREATE POLICY "Admins read qr_scans"
      ON public.qr_scans FOR SELECT TO authenticated
      USING (public.has_any_role('admin', 'superadmin'));
  END IF;
END $$;

-- 4.4 GCal sync
DO $$ BEGIN
  IF to_regclass('public.gcal_integration_settings') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins read gcal_integration_settings" ON public.gcal_integration_settings;
    CREATE POLICY "Admins read gcal_integration_settings"
      ON public.gcal_integration_settings FOR SELECT TO authenticated
      USING (public.has_any_role('admin', 'superadmin'));
    DROP POLICY IF EXISTS "Superadmins write gcal_integration_settings" ON public.gcal_integration_settings;
    CREATE POLICY "Superadmins write gcal_integration_settings"
      ON public.gcal_integration_settings FOR ALL TO authenticated
      USING (public.has_any_role('superadmin'))
      WITH CHECK (public.has_any_role('superadmin'));
  END IF;
  IF to_regclass('public.gcal_event_links') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins read gcal_event_links" ON public.gcal_event_links;
    CREATE POLICY "Admins read gcal_event_links"
      ON public.gcal_event_links FOR SELECT TO authenticated
      USING (public.has_any_role('admin', 'superadmin'));
  END IF;
  IF to_regclass('public.gcal_sync_queue') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins read gcal_sync_queue" ON public.gcal_sync_queue;
    CREATE POLICY "Admins read gcal_sync_queue"
      ON public.gcal_sync_queue FOR SELECT TO authenticated
      USING (public.has_any_role('admin', 'superadmin'));
  END IF;
END $$;

-- 4.5 Trunk-show GCal sync
DO $$ BEGIN
  IF to_regclass('public.trunk_show_gcal_event_links') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins read trunk_show_gcal_event_links" ON public.trunk_show_gcal_event_links;
    CREATE POLICY "Admins read trunk_show_gcal_event_links"
      ON public.trunk_show_gcal_event_links FOR SELECT TO authenticated
      USING (public.has_any_role('admin', 'superadmin'));
  END IF;
  IF to_regclass('public.trunk_show_gcal_sync_queue') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins read trunk_show_gcal_sync_queue" ON public.trunk_show_gcal_sync_queue;
    CREATE POLICY "Admins read trunk_show_gcal_sync_queue"
      ON public.trunk_show_gcal_sync_queue FOR SELECT TO authenticated
      USING (public.has_any_role('admin', 'superadmin'));
  END IF;
END $$;

-- 4.6 Notifications
DO $$ BEGIN
  IF to_regclass('public.notification_queue') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins read notification_queue" ON public.notification_queue;
    CREATE POLICY "Admins read notification_queue"
      ON public.notification_queue FOR SELECT TO authenticated
      USING (public.has_any_role('admin', 'superadmin'));
  END IF;
  IF to_regclass('public.notification_templates') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins read notification_templates" ON public.notification_templates;
    CREATE POLICY "Admins read notification_templates"
      ON public.notification_templates FOR SELECT TO authenticated
      USING (public.has_any_role('admin', 'superadmin'));
    DROP POLICY IF EXISTS "Superadmins write notification_templates" ON public.notification_templates;
    CREATE POLICY "Superadmins write notification_templates"
      ON public.notification_templates FOR ALL TO authenticated
      USING (public.has_any_role('superadmin'))
      WITH CHECK (public.has_any_role('superadmin'));
  END IF;
  IF to_regclass('public.scheduled_notifications') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins read scheduled_notifications" ON public.scheduled_notifications;
    CREATE POLICY "Admins read scheduled_notifications"
      ON public.scheduled_notifications FOR SELECT TO authenticated
      USING (public.has_any_role('admin', 'superadmin'));
    DROP POLICY IF EXISTS "Superadmins write scheduled_notifications" ON public.scheduled_notifications;
    CREATE POLICY "Superadmins write scheduled_notifications"
      ON public.scheduled_notifications FOR ALL TO authenticated
      USING (public.has_any_role('superadmin'))
      WITH CHECK (public.has_any_role('superadmin'));
  END IF;
  IF to_regclass('public.notification_settings') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins read notification_settings" ON public.notification_settings;
    CREATE POLICY "Admins read notification_settings"
      ON public.notification_settings FOR SELECT TO authenticated
      USING (public.has_any_role('admin', 'superadmin'));
    DROP POLICY IF EXISTS "Superadmins write notification_settings" ON public.notification_settings;
    CREATE POLICY "Superadmins write notification_settings"
      ON public.notification_settings FOR ALL TO authenticated
      USING (public.has_any_role('superadmin'))
      WITH CHECK (public.has_any_role('superadmin'));
  END IF;
END $$;

-- 4.7 Data research / QR campaign sends
DO $$ BEGIN
  IF to_regclass('public.qr_campaign_sends') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins read qr_campaign_sends" ON public.qr_campaign_sends;
    CREATE POLICY "Admins read qr_campaign_sends"
      ON public.qr_campaign_sends FOR SELECT TO authenticated
      USING (public.has_any_role('admin', 'superadmin'));
    DROP POLICY IF EXISTS "Superadmins write qr_campaign_sends" ON public.qr_campaign_sends;
    CREATE POLICY "Superadmins write qr_campaign_sends"
      ON public.qr_campaign_sends FOR ALL TO authenticated
      USING (public.has_any_role('superadmin'))
      WITH CHECK (public.has_any_role('superadmin'));
  END IF;
END $$;

-- 4.8 Event waitlist
DO $$ BEGIN
  IF to_regclass('public.event_waitlist') IS NOT NULL THEN
    DROP POLICY IF EXISTS "event_waitlist_delete" ON public.event_waitlist;
    CREATE POLICY "event_waitlist_delete"
      ON public.event_waitlist FOR DELETE TO authenticated
      USING (
        public.has_any_role('admin', 'superadmin')
        OR public.is_my_partner()
      );
  END IF;
END $$;

-- 4.9 Accounting view-all-expenses
DO $$ BEGIN
  IF to_regclass('public.expense_reports') IS NOT NULL THEN
    DROP POLICY IF EXISTS expense_reports_select ON public.expense_reports;
    CREATE POLICY expense_reports_select
      ON public.expense_reports FOR SELECT TO authenticated
      USING (
        public.has_any_role('admin', 'superadmin', 'accounting')
        OR public.get_effective_user_id() = user_id
      );
  END IF;
  IF to_regclass('public.expenses') IS NOT NULL
     AND to_regclass('public.expense_reports') IS NOT NULL THEN
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
  END IF;
END $$;

-- 4.10 Expenses pr1 (rest)
DO $$ BEGIN
  IF to_regclass('public.buyer_rates') IS NOT NULL THEN
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
  END IF;
  IF to_regclass('public.expense_reports') IS NOT NULL THEN
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
  END IF;
  IF to_regclass('public.expenses') IS NOT NULL
     AND to_regclass('public.expense_reports') IS NOT NULL THEN
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
  END IF;
  IF to_regclass('public.compensation_invoices') IS NOT NULL THEN
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
  END IF;
  IF to_regclass('public.compensation_line_items') IS NOT NULL
     AND to_regclass('public.compensation_invoices') IS NOT NULL THEN
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
  END IF;
END $$;

-- 4.11 Expense report templates
DO $$ BEGIN
  IF to_regclass('public.expense_report_templates') IS NOT NULL THEN
    DROP POLICY IF EXISTS templates_select ON public.expense_report_templates;
    CREATE POLICY templates_select
      ON public.expense_report_templates FOR SELECT TO authenticated
      USING (true);
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
  END IF;
END $$;

-- 4.12 Shipping (manifests + event scope)
DO $$ BEGIN
  IF to_regclass('public.shipping_manifests') IS NOT NULL THEN
    DROP POLICY IF EXISTS shipping_manifests_read ON public.shipping_manifests;
    CREATE POLICY shipping_manifests_read
      ON public.shipping_manifests FOR SELECT TO authenticated
      USING (true);
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
  END IF;
END $$;

-- 4.13 Shipping pr1 (event shipments + boxes)
DO $$ BEGIN
  IF to_regclass('public.event_shipments') IS NOT NULL THEN
    DROP POLICY IF EXISTS shipments_read ON public.event_shipments;
    CREATE POLICY shipments_read
      ON public.event_shipments FOR SELECT TO authenticated
      USING (true);
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
  END IF;
  IF to_regclass('public.event_shipment_boxes') IS NOT NULL THEN
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
  END IF;
END $$;

-- 4.14 Customer intakes
DO $$ BEGIN
  IF to_regclass('public.customer_intakes') IS NOT NULL THEN
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
  END IF;
END $$;

-- 4.15 Marketing payments
DO $$ BEGIN
  IF to_regclass('public.marketing_payment_methods') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins read methods" ON public.marketing_payment_methods;
    CREATE POLICY "Admins read methods"
      ON public.marketing_payment_methods FOR SELECT TO authenticated
      USING (public.has_any_role('admin', 'superadmin'));
    DROP POLICY IF EXISTS "Superadmins write methods" ON public.marketing_payment_methods;
    CREATE POLICY "Superadmins write methods"
      ON public.marketing_payment_methods FOR ALL TO authenticated
      USING (public.has_any_role('superadmin'))
      WITH CHECK (public.has_any_role('superadmin'));
  END IF;
  IF to_regclass('public.marketing_payment_types') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins read types" ON public.marketing_payment_types;
    CREATE POLICY "Admins read types"
      ON public.marketing_payment_types FOR SELECT TO authenticated
      USING (public.has_any_role('admin', 'superadmin'));
    DROP POLICY IF EXISTS "Superadmins write types" ON public.marketing_payment_types;
    CREATE POLICY "Superadmins write types"
      ON public.marketing_payment_types FOR ALL TO authenticated
      USING (public.has_any_role('superadmin'))
      WITH CHECK (public.has_any_role('superadmin'));
  END IF;
  IF to_regclass('public.marketing_payments') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins manage marketing_payments" ON public.marketing_payments;
    CREATE POLICY "Admins manage marketing_payments"
      ON public.marketing_payments FOR ALL TO authenticated
      USING (public.has_any_role('admin', 'superadmin'))
      WITH CHECK (public.has_any_role('admin', 'superadmin'));
  END IF;
END $$;

-- 4.16 Pre-event readiness
DO $$ BEGIN
  IF to_regclass('public.event_promotional_asset_orders') IS NOT NULL THEN
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
  END IF;
END $$;

-- 4.17 Buying-event spiffs
DO $$ BEGIN
  IF to_regclass('public.buying_event_spiff_payouts') IS NOT NULL THEN
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
  END IF;
END $$;

-- 4.18 Welcome email log
DO $$ BEGIN
  IF to_regclass('public.welcome_email_log') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins manage welcome_email_log" ON public.welcome_email_log;
    CREATE POLICY "Admins manage welcome_email_log"
      ON public.welcome_email_log FOR ALL TO authenticated
      USING (public.has_any_role('admin', 'superadmin'))
      WITH CHECK (public.has_any_role('admin', 'superadmin'));
  END IF;
END $$;

-- 4.19 Report templates
DO $$ BEGIN
  IF to_regclass('public.report_templates') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins manage report_templates" ON public.report_templates;
    CREATE POLICY "Admins manage report_templates"
      ON public.report_templates FOR ALL TO authenticated
      USING (public.has_any_role('admin', 'superadmin'))
      WITH CHECK (public.has_any_role('admin', 'superadmin'));
  END IF;
END $$;

-- 4.20 Reports v1
DO $$ BEGIN
  IF to_regclass('public.custom_reports') IS NOT NULL THEN
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
  END IF;
  IF to_regclass('public.custom_report_pins') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Users manage own custom_report_pins" ON public.custom_report_pins;
    CREATE POLICY "Users manage own custom_report_pins"
      ON public.custom_report_pins FOR ALL TO authenticated
      USING (user_id = public.get_effective_user_id())
      WITH CHECK (user_id = public.get_effective_user_id());
  END IF;
END $$;

-- 4.21 Trunk-comms phase 1
DO $$ BEGIN
  IF to_regclass('public.communication_templates') IS NOT NULL THEN
    DROP POLICY IF EXISTS "comm_templates_select" ON public.communication_templates;
    CREATE POLICY "comm_templates_select"
      ON public.communication_templates FOR SELECT TO authenticated
      USING (public.is_trunk_comms_admin());
    DROP POLICY IF EXISTS "comm_templates_write" ON public.communication_templates;
    CREATE POLICY "comm_templates_write"
      ON public.communication_templates FOR ALL TO authenticated
      USING (public.is_trunk_comms_admin())
      WITH CHECK (public.is_trunk_comms_admin());
  END IF;
  IF to_regclass('public.communication_send_schedules') IS NOT NULL THEN
    DROP POLICY IF EXISTS "comm_schedules_select" ON public.communication_send_schedules;
    CREATE POLICY "comm_schedules_select"
      ON public.communication_send_schedules FOR SELECT TO authenticated
      USING (public.is_trunk_comms_admin());
    DROP POLICY IF EXISTS "comm_schedules_write" ON public.communication_send_schedules;
    CREATE POLICY "comm_schedules_write"
      ON public.communication_send_schedules FOR ALL TO authenticated
      USING (public.is_trunk_comms_admin())
      WITH CHECK (public.is_trunk_comms_admin());
  END IF;
  IF to_regclass('public.communication_sends') IS NOT NULL THEN
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
  END IF;
  IF to_regclass('public.trunk_show_checklist_master') IS NOT NULL THEN
    DROP POLICY IF EXISTS "checklist_master_select" ON public.trunk_show_checklist_master;
    CREATE POLICY "checklist_master_select"
      ON public.trunk_show_checklist_master FOR SELECT TO authenticated
      USING (public.is_trunk_comms_admin());
    DROP POLICY IF EXISTS "checklist_master_write" ON public.trunk_show_checklist_master;
    CREATE POLICY "checklist_master_write"
      ON public.trunk_show_checklist_master FOR ALL TO authenticated
      USING (public.is_trunk_comms_admin())
      WITH CHECK (public.is_trunk_comms_admin());
  END IF;
  IF to_regclass('public.trunk_show_checklist_items') IS NOT NULL THEN
    DROP POLICY IF EXISTS "checklist_items_select" ON public.trunk_show_checklist_items;
    CREATE POLICY "checklist_items_select"
      ON public.trunk_show_checklist_items FOR SELECT TO authenticated
      USING (public.is_trunk_comms_admin());
    DROP POLICY IF EXISTS "checklist_items_write" ON public.trunk_show_checklist_items;
    CREATE POLICY "checklist_items_write"
      ON public.trunk_show_checklist_items FOR ALL TO authenticated
      USING (public.is_trunk_comms_admin())
      WITH CHECK (public.is_trunk_comms_admin());
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- Done.
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  RAISE NOTICE 'RLS auth-id tightening V2 complete: get_effective_user_id() tightened, is_trunk_comms_admin() tightened, stores INSERT/DELETE present, every brittle inline policy rewritten on the tables that actually exist.';
END $$;
