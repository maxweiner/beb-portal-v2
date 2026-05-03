-- ============================================================
-- Multi-role — PHASE 3: RLS rewrite from get_my_role() to has_any_role()
--
-- Mechanically re-creates every RLS policy in the public schema
-- that previously gated access via the single-role helper
--   public.get_my_role() IN ('a','b',...)  /  = 'a'  /  NOT IN (...)
-- so it instead calls
--   public.has_any_role('a','b',...)         (or NOT has_any_role(...))
-- which is multi-role aware: it consults the user_roles join
-- table seeded in Phase 1. As a result, additional roles granted
-- through the AdminPanel Role Manager (beyond the user's "primary"
-- users.role) finally translate into actual data access — not just
-- module visibility.
--
-- Every policy below is the verbatim "current state" body taken
-- from the latest migration to define it (later migrations win
-- when a policy was redefined), with ONLY the role-check helper
-- swapped. All other clauses — public.get_effective_user_id(),
-- public.is_my_partner(), JSONB worker membership EXISTS sub-
-- queries, ownership joins, has_marketing_access() — are left
-- untouched.
--
-- Helpers assumed to already exist (Phase 1):
--   public.has_any_role(VARIADIC text[]) RETURNS boolean
--   public.get_my_role()                 RETURNS text   (legacy, kept)
--   public.get_my_roles()                RETURNS text[] (Phase 1)
--   public.get_effective_user_id()       RETURNS uuid   (impersonation)
--   public.is_my_partner()               RETURNS boolean
--   public.has_marketing_access()        RETURNS boolean
-- This migration does NOT redefine any of them.
--
-- ── Tables touched (policy count) ───────────────────────────
--   appointments                            (1)
--   booking_config                          (1)
--   booth_cost_categories                   (2)
--   buyer_checks                            (1)
--   buyer_entries                           (1)
--   buyer_rates                             (2)
--   compensation_invoices                   (4)
--   compensation_line_items                 (4)
--   custom_reports                          (2)
--   customer_intakes                        (4)
--   event_booking_overrides                 (1)
--   event_days                              (1)
--   event_shipment_boxes                    (2)
--   event_shipments                         (2)
--   events                                  (1)
--   expense_reports                         (4)
--   expenses                                (4)
--   gcal_event_links                        (1)
--   gcal_integration_settings               (2)
--   gcal_sync_queue                         (1)
--   hot_show_alerts                         (1)
--   leads                                   (4)
--   marketing_emails_sent                   (1)
--   marketing_payment_methods               (2)  [+superadmin_write]
--   marketing_payment_types  (guarded)      (2)
--   marketing_payments       (guarded)      (1)
--   marketing_team_emails                   (1)  [superadmin_write]
--   marketing_approvers                     (1)  [superadmin_write]
--   notification_log                        (1)
--   notification_queue                      (1)
--   notification_settings                   (2)
--   notification_templates                  (2)
--   office_staff_notification_recipients    (2)
--   prospecting_notes (sales_rep_*)         (4)
--   qr_campaign_sends                       (2)
--   qr_codes                                (1)
--   qr_scans                                (1)
--   report_template_recipients              (2)
--   report_template_schedules               (2)
--   report_templates                        (1)
--   sales_rep_territories                   (2)
--   scheduled_notifications                 (2)
--   shipping_manifests                      (3)
--   slot_blocks                             (1)
--   spiff_config                            (1)
--   store_group_members                     (1)
--   store_groups                            (1)
--   store_portal_tokens                     (1)
--   trade_show_appointments                 (2)
--   trade_show_booth_costs                  (2)
--   trade_show_staff                        (2)
--   trade_shows                             (2)
--   travel_reservations                     (1)
--   trunk_show_appointment_slots            (2)
--   trunk_show_hours                        (2)
--   trunk_show_special_requests             (3)
--   trunk_show_spiffs                       (2)
--   trunk_shows                             (2)
--   user_roles                              (1)
--   welcome_email_log                       (1)
--
-- ── Why it's safe to re-run ─────────────────────────────────
-- Every block is `DROP POLICY IF EXISTS … ; CREATE POLICY …`.
-- No tables are altered. No functions are redefined. The two
-- guarded blocks (marketing_payment_types, marketing_payments,
-- appointment_employees) wrap their DDL in `to_regclass(...)`
-- checks so absent tables silently no-op. Re-running the file
-- after a partial failure simply re-installs the same end state.
-- ============================================================


-- ── user_roles ─────────────────────────────────────────────────
DROP POLICY IF EXISTS user_roles_write ON public.user_roles;
CREATE POLICY user_roles_write ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_any_role('admin', 'superadmin'))
  WITH CHECK (public.has_any_role('admin', 'superadmin'));


-- ── events / cascade-target tables (events DELETE patch) ───────
DROP POLICY IF EXISTS events_delete ON events;
CREATE POLICY events_delete ON events FOR DELETE TO public
  USING (public.has_any_role('admin', 'superadmin'));

DROP POLICY IF EXISTS buyer_checks_delete_admins ON buyer_checks;
CREATE POLICY buyer_checks_delete_admins ON buyer_checks FOR DELETE TO public
  USING (public.has_any_role('admin', 'superadmin'));

DROP POLICY IF EXISTS buyer_entries_delete_admins ON buyer_entries;
CREATE POLICY buyer_entries_delete_admins ON buyer_entries FOR DELETE TO public
  USING (public.has_any_role('admin', 'superadmin'));

DROP POLICY IF EXISTS event_days_delete_admins ON event_days;
CREATE POLICY event_days_delete_admins ON event_days FOR DELETE TO public
  USING (public.has_any_role('admin', 'superadmin'));


-- ── buyer_rates ────────────────────────────────────────────────
DROP POLICY IF EXISTS buyer_rates_select ON buyer_rates;
CREATE POLICY buyer_rates_select ON buyer_rates FOR SELECT TO public
  USING (
    buyer_rates.user_id = public.get_effective_user_id()
    OR public.has_any_role('admin','superadmin')
  );

DROP POLICY IF EXISTS buyer_rates_manage ON buyer_rates;
CREATE POLICY buyer_rates_manage ON buyer_rates FOR ALL TO public
  USING (public.has_any_role('admin','superadmin'))
  WITH CHECK (public.has_any_role('admin','superadmin'));


-- ── expense_reports ────────────────────────────────────────────
DROP POLICY IF EXISTS expense_reports_select ON expense_reports;
CREATE POLICY expense_reports_select ON expense_reports FOR SELECT TO public
  USING (
    expense_reports.user_id = public.get_effective_user_id()
    OR public.has_any_role('admin','superadmin','accounting')
  );

DROP POLICY IF EXISTS expense_reports_insert ON expense_reports;
CREATE POLICY expense_reports_insert ON expense_reports FOR INSERT TO public
  WITH CHECK (
    expense_reports.user_id = public.get_effective_user_id()
    OR public.has_any_role('admin','superadmin')
  );

DROP POLICY IF EXISTS expense_reports_update ON expense_reports;
CREATE POLICY expense_reports_update ON expense_reports FOR UPDATE TO public
  USING (
    (expense_reports.user_id = public.get_effective_user_id() AND expense_reports.status = 'active')
    OR public.has_any_role('admin','superadmin')
  )
  WITH CHECK (
    expense_reports.user_id = public.get_effective_user_id()
    OR public.has_any_role('admin','superadmin')
  );

-- expense_reports_delete: latest body comes from
-- supabase-migration-expense-reports-owner-delete.sql which is
-- more permissive than the impersonation patch's version.
DROP POLICY IF EXISTS expense_reports_delete ON expense_reports;
CREATE POLICY expense_reports_delete ON expense_reports FOR DELETE TO public
  USING (
    public.has_any_role('admin','superadmin')
    OR (
      expense_reports.user_id = public.get_effective_user_id()
      AND expense_reports.status = 'active'
    )
  );


-- ── expenses ───────────────────────────────────────────────────
DROP POLICY IF EXISTS expenses_select ON expenses;
CREATE POLICY expenses_select ON expenses FOR SELECT TO public
  USING (
    EXISTS (
      SELECT 1 FROM expense_reports r
      WHERE r.id = expenses.expense_report_id
        AND (
          r.user_id = public.get_effective_user_id()
          OR public.has_any_role('admin','superadmin','accounting')
        )
    )
  );

DROP POLICY IF EXISTS expenses_insert ON expenses;
CREATE POLICY expenses_insert ON expenses FOR INSERT TO public
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM expense_reports r
      WHERE r.id = expenses.expense_report_id
        AND (
          (r.user_id = public.get_effective_user_id() AND r.status = 'active')
          OR public.has_any_role('admin','superadmin')
        )
    )
  );

DROP POLICY IF EXISTS expenses_update ON expenses;
CREATE POLICY expenses_update ON expenses FOR UPDATE TO public
  USING (
    EXISTS (
      SELECT 1 FROM expense_reports r
      WHERE r.id = expenses.expense_report_id
        AND (
          (r.user_id = public.get_effective_user_id() AND r.status = 'active')
          OR public.has_any_role('admin','superadmin')
        )
    )
  );

DROP POLICY IF EXISTS expenses_delete ON expenses;
CREATE POLICY expenses_delete ON expenses FOR DELETE TO public
  USING (
    EXISTS (
      SELECT 1 FROM expense_reports r
      WHERE r.id = expenses.expense_report_id
        AND (
          (r.user_id = public.get_effective_user_id() AND r.status = 'active')
          OR public.has_any_role('admin','superadmin')
        )
    )
  );


-- ── compensation_invoices ──────────────────────────────────────
DROP POLICY IF EXISTS compensation_invoices_select ON compensation_invoices;
CREATE POLICY compensation_invoices_select ON compensation_invoices FOR SELECT TO public
  USING (
    compensation_invoices.user_id = public.get_effective_user_id()
    OR public.has_any_role('admin','superadmin')
  );

DROP POLICY IF EXISTS compensation_invoices_insert ON compensation_invoices;
CREATE POLICY compensation_invoices_insert ON compensation_invoices FOR INSERT TO public
  WITH CHECK (
    compensation_invoices.user_id = public.get_effective_user_id()
    OR public.has_any_role('admin','superadmin')
  );

DROP POLICY IF EXISTS compensation_invoices_update ON compensation_invoices;
CREATE POLICY compensation_invoices_update ON compensation_invoices FOR UPDATE TO public
  USING (
    (compensation_invoices.user_id = public.get_effective_user_id() AND compensation_invoices.status = 'active')
    OR public.has_any_role('admin','superadmin')
  )
  WITH CHECK (
    compensation_invoices.user_id = public.get_effective_user_id()
    OR public.has_any_role('admin','superadmin')
  );

DROP POLICY IF EXISTS compensation_invoices_delete ON compensation_invoices;
CREATE POLICY compensation_invoices_delete ON compensation_invoices FOR DELETE TO public
  USING (public.has_any_role('admin','superadmin'));


-- ── compensation_line_items ────────────────────────────────────
DROP POLICY IF EXISTS compensation_line_items_select ON compensation_line_items;
CREATE POLICY compensation_line_items_select ON compensation_line_items FOR SELECT TO public
  USING (
    EXISTS (
      SELECT 1 FROM compensation_invoices ci
      WHERE ci.id = compensation_line_items.compensation_invoice_id
        AND (
          ci.user_id = public.get_effective_user_id()
          OR public.has_any_role('admin','superadmin')
        )
    )
  );

DROP POLICY IF EXISTS compensation_line_items_insert ON compensation_line_items;
CREATE POLICY compensation_line_items_insert ON compensation_line_items FOR INSERT TO public
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM compensation_invoices ci
      WHERE ci.id = compensation_line_items.compensation_invoice_id
        AND (
          (ci.user_id = public.get_effective_user_id() AND ci.status = 'active')
          OR public.has_any_role('admin','superadmin')
        )
    )
  );

DROP POLICY IF EXISTS compensation_line_items_update ON compensation_line_items;
CREATE POLICY compensation_line_items_update ON compensation_line_items FOR UPDATE TO public
  USING (
    EXISTS (
      SELECT 1 FROM compensation_invoices ci
      WHERE ci.id = compensation_line_items.compensation_invoice_id
        AND (
          (ci.user_id = public.get_effective_user_id() AND ci.status = 'active')
          OR public.has_any_role('admin','superadmin')
        )
    )
  );

DROP POLICY IF EXISTS compensation_line_items_delete ON compensation_line_items;
CREATE POLICY compensation_line_items_delete ON compensation_line_items FOR DELETE TO public
  USING (
    EXISTS (
      SELECT 1 FROM compensation_invoices ci
      WHERE ci.id = compensation_line_items.compensation_invoice_id
        AND (
          (ci.user_id = public.get_effective_user_id() AND ci.status = 'active')
          OR public.has_any_role('admin','superadmin')
        )
    )
  );


-- ── event_shipment_boxes ───────────────────────────────────────
DROP POLICY IF EXISTS boxes_read ON event_shipment_boxes;
CREATE POLICY boxes_read ON event_shipment_boxes FOR SELECT TO public
  USING (public.has_any_role('buyer','admin','superadmin'));

DROP POLICY IF EXISTS boxes_manage ON event_shipment_boxes;
CREATE POLICY boxes_manage ON event_shipment_boxes FOR ALL TO public
  USING (
    public.has_any_role('admin','superadmin')
    OR EXISTS (
      SELECT 1
      FROM event_shipments s
      JOIN events e ON e.id = s.event_id
      WHERE s.id = event_shipment_boxes.shipment_id
        AND e.workers @> jsonb_build_array(jsonb_build_object('id', public.get_effective_user_id()::text))
    )
  )
  WITH CHECK (
    public.has_any_role('admin','superadmin')
    OR EXISTS (
      SELECT 1
      FROM event_shipments s
      JOIN events e ON e.id = s.event_id
      WHERE s.id = event_shipment_boxes.shipment_id
        AND e.workers @> jsonb_build_array(jsonb_build_object('id', public.get_effective_user_id()::text))
    )
  );


-- ── event_shipments ────────────────────────────────────────────
DROP POLICY IF EXISTS shipments_read ON event_shipments;
CREATE POLICY shipments_read ON event_shipments FOR SELECT TO public
  USING (public.has_any_role('buyer','admin','superadmin'));

DROP POLICY IF EXISTS shipments_manage ON event_shipments;
CREATE POLICY shipments_manage ON event_shipments FOR ALL TO public
  USING (public.has_any_role('admin','superadmin'))
  WITH CHECK (public.has_any_role('admin','superadmin'));


-- ── shipping_manifests ─────────────────────────────────────────
DROP POLICY IF EXISTS shipping_manifests_read ON shipping_manifests;
CREATE POLICY shipping_manifests_read ON shipping_manifests FOR SELECT TO public
  USING (public.has_any_role('buyer','admin','superadmin'));

DROP POLICY IF EXISTS shipping_manifests_insert ON shipping_manifests;
CREATE POLICY shipping_manifests_insert ON shipping_manifests FOR INSERT TO public
  WITH CHECK (
    public.has_any_role('admin','superadmin')
    OR EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = shipping_manifests.event_id
        AND e.workers @> jsonb_build_array(jsonb_build_object('id', public.get_effective_user_id()::text))
    )
  );

DROP POLICY IF EXISTS shipping_manifests_update ON shipping_manifests;
CREATE POLICY shipping_manifests_update ON shipping_manifests FOR UPDATE TO public
  USING (
    public.has_any_role('admin','superadmin')
    OR EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = shipping_manifests.event_id
        AND e.workers @> jsonb_build_array(jsonb_build_object('id', public.get_effective_user_id()::text))
    )
  );


-- ── marketing_payment_methods ──────────────────────────────────
-- Two overlapping bodies exist in the codebase: the
-- impersonation phase 1.5 patch's "Admins read methods" /
-- "Superadmins write methods" pair, AND the marketing-phase-1
-- schema's "superadmin_write" policy. Both refer to the same
-- table. Re-issue both so neither lingers with get_my_role().
DROP POLICY IF EXISTS "Admins read methods" ON marketing_payment_methods;
CREATE POLICY "Admins read methods"
  ON marketing_payment_methods FOR SELECT TO authenticated
  USING (public.has_any_role('admin','superadmin'));

DROP POLICY IF EXISTS "Superadmins write methods" ON marketing_payment_methods;
CREATE POLICY "Superadmins write methods"
  ON marketing_payment_methods FOR ALL TO authenticated
  USING (public.has_any_role('superadmin'))
  WITH CHECK (public.has_any_role('superadmin'));

DROP POLICY IF EXISTS superadmin_write ON marketing_payment_methods;
CREATE POLICY superadmin_write ON marketing_payment_methods
  FOR ALL USING (public.has_any_role('superadmin'))
  WITH CHECK (public.has_any_role('superadmin'));


-- ── marketing_team_emails ──────────────────────────────────────
DROP POLICY IF EXISTS superadmin_write ON marketing_team_emails;
CREATE POLICY superadmin_write ON marketing_team_emails
  FOR ALL USING (public.has_any_role('superadmin'))
  WITH CHECK (public.has_any_role('superadmin'));


-- ── marketing_approvers ────────────────────────────────────────
DROP POLICY IF EXISTS superadmin_write ON marketing_approvers;
CREATE POLICY superadmin_write ON marketing_approvers
  FOR ALL USING (public.has_any_role('superadmin'))
  WITH CHECK (public.has_any_role('superadmin'));


-- ── marketing_payment_types  (guarded — table may not exist) ───
DO $$
BEGIN
  IF to_regclass('public.marketing_payment_types') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Admins read types" ON marketing_payment_types';
    EXECUTE $p$CREATE POLICY "Admins read types"
      ON marketing_payment_types FOR SELECT TO authenticated
      USING (public.has_any_role('admin','superadmin'))$p$;
    EXECUTE 'DROP POLICY IF EXISTS "Superadmins write types" ON marketing_payment_types';
    EXECUTE $p$CREATE POLICY "Superadmins write types"
      ON marketing_payment_types FOR ALL TO authenticated
      USING (public.has_any_role('superadmin'))
      WITH CHECK (public.has_any_role('superadmin'))$p$;
  END IF;
END $$;


-- ── marketing_payments  (guarded — table may not exist) ────────
DO $$
BEGIN
  IF to_regclass('public.marketing_payments') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Admins manage marketing_payments" ON marketing_payments';
    EXECUTE $p$CREATE POLICY "Admins manage marketing_payments"
      ON marketing_payments FOR ALL TO authenticated
      USING (public.has_any_role('admin','superadmin'))
      WITH CHECK (public.has_any_role('admin','superadmin'))$p$;
  END IF;
END $$;


-- ── marketing_emails_sent ──────────────────────────────────────
DROP POLICY IF EXISTS "Admins can read marketing email log" ON marketing_emails_sent;
CREATE POLICY "Admins can read marketing email log"
  ON marketing_emails_sent FOR SELECT
  USING (public.has_any_role('admin','superadmin'));


-- ── custom_reports ─────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins read custom_reports" ON custom_reports;
CREATE POLICY "Admins read custom_reports"
  ON custom_reports FOR SELECT TO authenticated
  USING (
    public.has_any_role('admin','superadmin')
    AND (
      visibility = 'global'
      OR (visibility = 'store')
      OR created_by = public.get_effective_user_id()
      OR public.has_any_role('superadmin')
    )
  );

DROP POLICY IF EXISTS "Creators and superadmins write custom_reports" ON custom_reports;
CREATE POLICY "Creators and superadmins write custom_reports"
  ON custom_reports FOR ALL TO authenticated
  USING (
    created_by = public.get_effective_user_id()
    OR public.has_any_role('superadmin')
  )
  WITH CHECK (
    created_by = public.get_effective_user_id()
    OR public.has_any_role('superadmin')
  );


-- ── gcal_integration_settings ──────────────────────────────────
DROP POLICY IF EXISTS "Admins read gcal_integration_settings" ON gcal_integration_settings;
CREATE POLICY "Admins read gcal_integration_settings"
  ON gcal_integration_settings FOR SELECT TO authenticated
  USING (public.has_any_role('admin','superadmin'));

DROP POLICY IF EXISTS "Superadmins write gcal_integration_settings" ON gcal_integration_settings;
CREATE POLICY "Superadmins write gcal_integration_settings"
  ON gcal_integration_settings FOR ALL TO authenticated
  USING (public.has_any_role('superadmin'))
  WITH CHECK (public.has_any_role('superadmin'));


-- ── gcal_event_links ───────────────────────────────────────────
DROP POLICY IF EXISTS "Admins read gcal_event_links" ON gcal_event_links;
CREATE POLICY "Admins read gcal_event_links"
  ON gcal_event_links FOR SELECT TO authenticated
  USING (public.has_any_role('admin','superadmin'));


-- ── gcal_sync_queue ────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins read gcal_sync_queue" ON gcal_sync_queue;
CREATE POLICY "Admins read gcal_sync_queue"
  ON gcal_sync_queue FOR SELECT TO authenticated
  USING (public.has_any_role('admin','superadmin'));


-- ── qr_campaign_sends ──────────────────────────────────────────
DROP POLICY IF EXISTS "Admins read qr_campaign_sends" ON qr_campaign_sends;
CREATE POLICY "Admins read qr_campaign_sends"
  ON qr_campaign_sends FOR SELECT TO authenticated
  USING (public.has_any_role('admin','superadmin'));

DROP POLICY IF EXISTS "Superadmins write qr_campaign_sends" ON qr_campaign_sends;
CREATE POLICY "Superadmins write qr_campaign_sends"
  ON qr_campaign_sends FOR ALL TO authenticated
  USING (public.has_any_role('admin','superadmin'))
  WITH CHECK (public.has_any_role('admin','superadmin'));


-- ── notification_templates ─────────────────────────────────────
DROP POLICY IF EXISTS "Admins read notification_templates" ON notification_templates;
CREATE POLICY "Admins read notification_templates"
  ON notification_templates FOR SELECT TO authenticated
  USING (public.has_any_role('admin','superadmin'));

DROP POLICY IF EXISTS "Superadmins write notification_templates" ON notification_templates;
CREATE POLICY "Superadmins write notification_templates"
  ON notification_templates FOR ALL TO authenticated
  USING (public.has_any_role('superadmin'))
  WITH CHECK (public.has_any_role('superadmin'));


-- ── scheduled_notifications ────────────────────────────────────
DROP POLICY IF EXISTS "Admins read scheduled_notifications" ON scheduled_notifications;
CREATE POLICY "Admins read scheduled_notifications"
  ON scheduled_notifications FOR SELECT TO authenticated
  USING (public.has_any_role('admin','superadmin'));

DROP POLICY IF EXISTS "Superadmins write scheduled_notifications" ON scheduled_notifications;
CREATE POLICY "Superadmins write scheduled_notifications"
  ON scheduled_notifications FOR ALL TO authenticated
  USING (public.has_any_role('superadmin'))
  WITH CHECK (public.has_any_role('superadmin'));


-- ── notification_settings ──────────────────────────────────────
DROP POLICY IF EXISTS "Admins read notification_settings" ON notification_settings;
CREATE POLICY "Admins read notification_settings"
  ON notification_settings FOR SELECT TO authenticated
  USING (public.has_any_role('admin','superadmin'));

DROP POLICY IF EXISTS "Superadmins write notification_settings" ON notification_settings;
CREATE POLICY "Superadmins write notification_settings"
  ON notification_settings FOR ALL TO authenticated
  USING (public.has_any_role('superadmin'))
  WITH CHECK (public.has_any_role('superadmin'));


-- ── welcome_email_log ──────────────────────────────────────────
DROP POLICY IF EXISTS "Admins manage welcome_email_log" ON welcome_email_log;
CREATE POLICY "Admins manage welcome_email_log"
  ON welcome_email_log FOR ALL TO authenticated
  USING (public.has_any_role('admin','superadmin'))
  WITH CHECK (public.has_any_role('admin','superadmin'));


-- ── notification_queue ─────────────────────────────────────────
DROP POLICY IF EXISTS "Admins read notification_queue" ON notification_queue;
CREATE POLICY "Admins read notification_queue"
  ON notification_queue FOR SELECT TO authenticated
  USING (public.has_any_role('admin','superadmin'));


-- ── report_templates ───────────────────────────────────────────
DROP POLICY IF EXISTS "Admins manage report_templates" ON report_templates;
CREATE POLICY "Admins manage report_templates"
  ON report_templates FOR ALL TO authenticated
  USING (public.has_any_role('admin','superadmin'))
  WITH CHECK (public.has_any_role('admin','superadmin'));


-- ── store_groups ───────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins manage store_groups" ON store_groups;
CREATE POLICY "Admins manage store_groups"
  ON store_groups FOR ALL TO authenticated
  USING (public.has_any_role('admin','superadmin'))
  WITH CHECK (public.has_any_role('admin','superadmin'));


-- ── store_group_members ────────────────────────────────────────
DROP POLICY IF EXISTS "Admins manage store_group_members" ON store_group_members;
CREATE POLICY "Admins manage store_group_members"
  ON store_group_members FOR ALL TO authenticated
  USING (public.has_any_role('admin','superadmin'))
  WITH CHECK (public.has_any_role('admin','superadmin'));


-- ── qr_codes ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins manage qr_codes" ON qr_codes;
CREATE POLICY "Admins manage qr_codes"
  ON qr_codes FOR ALL TO authenticated
  USING (public.has_any_role('admin','superadmin'))
  WITH CHECK (public.has_any_role('admin','superadmin'));


-- ── qr_scans ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins read qr_scans" ON qr_scans;
CREATE POLICY "Admins read qr_scans"
  ON qr_scans FOR SELECT TO authenticated
  USING (public.has_any_role('admin','superadmin'));


-- ── event_booking_overrides ────────────────────────────────────
DROP POLICY IF EXISTS "Admins manage event_booking_overrides" ON event_booking_overrides;
CREATE POLICY "Admins manage event_booking_overrides"
  ON event_booking_overrides FOR ALL TO authenticated
  USING (public.has_any_role('admin','superadmin'))
  WITH CHECK (public.has_any_role('admin','superadmin'));


-- ── slot_blocks ────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins manage slot_blocks" ON slot_blocks;
CREATE POLICY "Admins manage slot_blocks"
  ON slot_blocks FOR ALL TO authenticated
  USING (public.has_any_role('admin','superadmin'))
  WITH CHECK (public.has_any_role('admin','superadmin'));


-- ── appointments ───────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins manage appointments" ON appointments;
CREATE POLICY "Admins manage appointments"
  ON appointments FOR ALL TO authenticated
  USING (public.has_any_role('admin','superadmin'))
  WITH CHECK (public.has_any_role('admin','superadmin'));


-- ── notification_log ───────────────────────────────────────────
DROP POLICY IF EXISTS "Admins read notification_log" ON notification_log;
CREATE POLICY "Admins read notification_log"
  ON notification_log FOR SELECT TO authenticated
  USING (public.has_any_role('admin','superadmin'));


-- ── hot_show_alerts ────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins read hot_show_alerts" ON hot_show_alerts;
CREATE POLICY "Admins read hot_show_alerts"
  ON hot_show_alerts FOR SELECT TO authenticated
  USING (public.has_any_role('admin','superadmin'));


-- ── booking_config ─────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins manage booking_config" ON booking_config;
CREATE POLICY "Admins manage booking_config"
  ON booking_config FOR ALL TO authenticated
  USING (public.has_any_role('admin','superadmin'))
  WITH CHECK (public.has_any_role('admin','superadmin'));


-- ── appointment_employees  (guarded — table may not exist) ─────
DO $$
BEGIN
  IF to_regclass('public.appointment_employees') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Admins manage appointment_employees" ON appointment_employees';
    EXECUTE $p$CREATE POLICY "Admins manage appointment_employees"
      ON appointment_employees FOR ALL TO authenticated
      USING (public.has_any_role('admin','superadmin'))
      WITH CHECK (public.has_any_role('admin','superadmin'))$p$;
  END IF;
END $$;


-- ── store_portal_tokens ────────────────────────────────────────
DROP POLICY IF EXISTS "Admins manage store_portal_tokens" ON store_portal_tokens;
CREATE POLICY "Admins manage store_portal_tokens"
  ON store_portal_tokens FOR ALL TO authenticated
  USING (public.has_any_role('admin','superadmin'))
  WITH CHECK (public.has_any_role('admin','superadmin'));


-- ── customer_intakes ───────────────────────────────────────────
DROP POLICY IF EXISTS "Buyers can insert intakes for their events" ON customer_intakes;
CREATE POLICY "Buyers can insert intakes for their events"
  ON customer_intakes FOR INSERT
  TO authenticated
  WITH CHECK (
    customer_intakes.buyer_id = public.get_effective_user_id()
  );

DROP POLICY IF EXISTS "Buyers can read own intakes" ON customer_intakes;
CREATE POLICY "Buyers can read own intakes"
  ON customer_intakes FOR SELECT
  TO authenticated
  USING (
    customer_intakes.buyer_id = public.get_effective_user_id()
    OR public.has_any_role('admin','superadmin')
  );

DROP POLICY IF EXISTS "Buyers can update own intakes" ON customer_intakes;
CREATE POLICY "Buyers can update own intakes"
  ON customer_intakes FOR UPDATE
  TO authenticated
  USING (
    customer_intakes.buyer_id = public.get_effective_user_id()
    OR public.has_any_role('admin','superadmin')
  );

DROP POLICY IF EXISTS "Admins can delete intakes" ON customer_intakes;
CREATE POLICY "Admins can delete intakes"
  ON customer_intakes FOR DELETE
  TO authenticated
  USING (public.has_any_role('admin','superadmin'));


-- ── travel_reservations ────────────────────────────────────────
DROP POLICY IF EXISTS travel_reservations_read ON travel_reservations;
CREATE POLICY travel_reservations_read ON travel_reservations
  FOR SELECT TO authenticated
  USING (
    travel_reservations.buyer_id = public.get_effective_user_id()
    OR public.has_any_role('admin','superadmin')
  );


-- ── report_template_schedules ──────────────────────────────────
DROP POLICY IF EXISTS "Admins read schedules" ON report_template_schedules;
CREATE POLICY "Admins read schedules"
  ON report_template_schedules FOR SELECT TO public
  USING (public.has_any_role('admin', 'superadmin'));

DROP POLICY IF EXISTS "Admins manage schedules" ON report_template_schedules;
CREATE POLICY "Admins manage schedules"
  ON report_template_schedules FOR ALL TO public
  USING (public.has_any_role('admin', 'superadmin'))
  WITH CHECK (public.has_any_role('admin', 'superadmin'));


-- ── report_template_recipients ─────────────────────────────────
DROP POLICY IF EXISTS "Admins read recipients" ON report_template_recipients;
CREATE POLICY "Admins read recipients"
  ON report_template_recipients FOR SELECT TO public
  USING (public.has_any_role('admin', 'superadmin'));

DROP POLICY IF EXISTS "Admins manage recipients" ON report_template_recipients;
CREATE POLICY "Admins manage recipients"
  ON report_template_recipients FOR ALL TO public
  USING (public.has_any_role('admin', 'superadmin'))
  WITH CHECK (public.has_any_role('admin', 'superadmin'));


-- ────────────────────────────────────────────────────────────────
-- Sales-rep + trade-show + trunk-show domain
-- ────────────────────────────────────────────────────────────────


-- ── booth_cost_categories ──────────────────────────────────────
DROP POLICY IF EXISTS booth_cost_categories_read ON booth_cost_categories;
CREATE POLICY booth_cost_categories_read ON booth_cost_categories
  FOR SELECT TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin', 'sales_rep')
    OR public.is_my_partner()
  );

DROP POLICY IF EXISTS booth_cost_categories_write ON booth_cost_categories;
CREATE POLICY booth_cost_categories_write ON booth_cost_categories
  FOR ALL TO authenticated
  USING (public.has_any_role('admin', 'superadmin'))
  WITH CHECK (public.has_any_role('admin', 'superadmin'));


-- ── trade_shows ────────────────────────────────────────────────
DROP POLICY IF EXISTS trade_shows_read ON trade_shows;
CREATE POLICY trade_shows_read ON trade_shows
  FOR SELECT TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin', 'sales_rep')
    OR public.is_my_partner()
  );

DROP POLICY IF EXISTS trade_shows_write ON trade_shows;
CREATE POLICY trade_shows_write ON trade_shows
  FOR ALL TO authenticated
  USING (public.has_any_role('admin', 'superadmin') OR public.is_my_partner())
  WITH CHECK (public.has_any_role('admin', 'superadmin') OR public.is_my_partner());


-- ── trade_show_staff ───────────────────────────────────────────
DROP POLICY IF EXISTS trade_show_staff_read ON trade_show_staff;
CREATE POLICY trade_show_staff_read ON trade_show_staff
  FOR SELECT TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin', 'sales_rep')
    OR public.is_my_partner()
  );

DROP POLICY IF EXISTS trade_show_staff_write ON trade_show_staff;
CREATE POLICY trade_show_staff_write ON trade_show_staff
  FOR ALL TO authenticated
  USING (public.has_any_role('admin', 'superadmin') OR public.is_my_partner())
  WITH CHECK (public.has_any_role('admin', 'superadmin') OR public.is_my_partner());


-- ── trade_show_booth_costs ─────────────────────────────────────
DROP POLICY IF EXISTS trade_show_booth_costs_read ON trade_show_booth_costs;
CREATE POLICY trade_show_booth_costs_read ON trade_show_booth_costs
  FOR SELECT TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin', 'sales_rep')
    OR public.is_my_partner()
  );

DROP POLICY IF EXISTS trade_show_booth_costs_write ON trade_show_booth_costs;
CREATE POLICY trade_show_booth_costs_write ON trade_show_booth_costs
  FOR ALL TO authenticated
  USING (public.has_any_role('admin', 'superadmin') OR public.is_my_partner())
  WITH CHECK (public.has_any_role('admin', 'superadmin') OR public.is_my_partner());


-- ── leads ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS leads_read ON leads;
CREATE POLICY leads_read ON leads
  FOR SELECT TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
    OR (
      public.has_any_role('sales_rep')
      AND (
        leads.assigned_rep_id   = public.get_effective_user_id()
        OR leads.captured_by_user_id = public.get_effective_user_id()
      )
    )
  );

DROP POLICY IF EXISTS leads_insert ON leads;
CREATE POLICY leads_insert ON leads
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role('admin', 'superadmin', 'sales_rep')
    OR public.is_my_partner()
  );

DROP POLICY IF EXISTS leads_update ON leads;
CREATE POLICY leads_update ON leads
  FOR UPDATE TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
    OR (
      public.has_any_role('sales_rep')
      AND (
        leads.assigned_rep_id   = public.get_effective_user_id()
        OR leads.captured_by_user_id = public.get_effective_user_id()
      )
    )
  );

DROP POLICY IF EXISTS leads_delete ON leads;
CREATE POLICY leads_delete ON leads
  FOR DELETE TO authenticated
  USING (public.has_any_role('admin', 'superadmin') OR public.is_my_partner());


-- ── trade_show_appointments ────────────────────────────────────
DROP POLICY IF EXISTS trade_show_appts_read ON trade_show_appointments;
CREATE POLICY trade_show_appts_read ON trade_show_appointments
  FOR SELECT TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin', 'sales_rep')
    OR public.is_my_partner()
  );

DROP POLICY IF EXISTS trade_show_appts_write ON trade_show_appointments;
CREATE POLICY trade_show_appts_write ON trade_show_appointments
  FOR ALL TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
    OR (public.has_any_role('sales_rep')
        AND assigned_staff_id = public.get_effective_user_id())
  )
  WITH CHECK (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
    OR public.has_any_role('sales_rep')
  );


-- ── trunk_shows ────────────────────────────────────────────────
-- Latest body comes from supabase-migration-trunk-admin-rls.sql
-- (adds 'trunk_admin' to the role set).
DROP POLICY IF EXISTS trunk_shows_read ON trunk_shows;
CREATE POLICY trunk_shows_read ON trunk_shows
  FOR SELECT TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
    OR (public.has_any_role('sales_rep')
        AND assigned_rep_id = public.get_effective_user_id())
  );

DROP POLICY IF EXISTS trunk_shows_write ON trunk_shows;
CREATE POLICY trunk_shows_write ON trunk_shows
  FOR ALL TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
    OR (public.has_any_role('sales_rep')
        AND assigned_rep_id = public.get_effective_user_id())
  )
  WITH CHECK (
    public.has_any_role('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
    OR public.has_any_role('sales_rep')
  );


-- ── trunk_show_hours ───────────────────────────────────────────
DROP POLICY IF EXISTS trunk_show_hours_read ON trunk_show_hours;
CREATE POLICY trunk_show_hours_read ON trunk_show_hours
  FOR SELECT TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
    OR EXISTS (
      SELECT 1 FROM trunk_shows ts
      WHERE ts.id = trunk_show_hours.trunk_show_id
        AND ts.assigned_rep_id = public.get_effective_user_id()
    )
  );

DROP POLICY IF EXISTS trunk_show_hours_write ON trunk_show_hours;
CREATE POLICY trunk_show_hours_write ON trunk_show_hours
  FOR ALL TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
    OR EXISTS (
      SELECT 1 FROM trunk_shows ts
      WHERE ts.id = trunk_show_hours.trunk_show_id
        AND ts.assigned_rep_id = public.get_effective_user_id()
    )
  )
  WITH CHECK (
    public.has_any_role('admin', 'superadmin', 'trunk_admin', 'sales_rep')
    OR public.is_my_partner()
  );


-- ── office_staff_notification_recipients ───────────────────────
DROP POLICY IF EXISTS osnr_read ON office_staff_notification_recipients;
CREATE POLICY osnr_read ON office_staff_notification_recipients
  FOR SELECT TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
  );

DROP POLICY IF EXISTS osnr_write ON office_staff_notification_recipients;
CREATE POLICY osnr_write ON office_staff_notification_recipients
  FOR ALL TO authenticated
  USING (public.has_any_role('admin', 'superadmin', 'trunk_admin'))
  WITH CHECK (public.has_any_role('admin', 'superadmin', 'trunk_admin'));


-- ── trunk_show_special_requests ────────────────────────────────
DROP POLICY IF EXISTS special_requests_read ON trunk_show_special_requests;
CREATE POLICY special_requests_read ON trunk_show_special_requests
  FOR SELECT TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
    OR EXISTS (
      SELECT 1 FROM trunk_shows ts
      WHERE ts.id = trunk_show_special_requests.trunk_show_id
        AND ts.assigned_rep_id = public.get_effective_user_id()
    )
    OR EXISTS (
      SELECT 1 FROM office_staff_notification_recipients osnr
      WHERE osnr.user_id = public.get_effective_user_id()
        AND osnr.is_active = TRUE
    )
  );

DROP POLICY IF EXISTS special_requests_insert ON trunk_show_special_requests;
CREATE POLICY special_requests_insert ON trunk_show_special_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
    OR EXISTS (
      SELECT 1 FROM trunk_shows ts
      WHERE ts.id = trunk_show_special_requests.trunk_show_id
        AND ts.assigned_rep_id = public.get_effective_user_id()
    )
  );

DROP POLICY IF EXISTS special_requests_update ON trunk_show_special_requests;
CREATE POLICY special_requests_update ON trunk_show_special_requests
  FOR UPDATE TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
    OR EXISTS (
      SELECT 1 FROM office_staff_notification_recipients osnr
      WHERE osnr.user_id = public.get_effective_user_id()
        AND osnr.is_active = TRUE
    )
  );


-- ── trunk_show_appointment_slots ───────────────────────────────
DROP POLICY IF EXISTS trunk_show_slots_read ON trunk_show_appointment_slots;
CREATE POLICY trunk_show_slots_read ON trunk_show_appointment_slots
  FOR SELECT TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
    OR EXISTS (
      SELECT 1 FROM trunk_shows ts
      WHERE ts.id = trunk_show_appointment_slots.trunk_show_id
        AND ts.assigned_rep_id = public.get_effective_user_id()
    )
  );

DROP POLICY IF EXISTS trunk_show_slots_write ON trunk_show_appointment_slots;
CREATE POLICY trunk_show_slots_write ON trunk_show_appointment_slots
  FOR ALL TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
    OR EXISTS (
      SELECT 1 FROM trunk_shows ts
      WHERE ts.id = trunk_show_appointment_slots.trunk_show_id
        AND ts.assigned_rep_id = public.get_effective_user_id()
    )
  )
  WITH CHECK (
    public.has_any_role('admin', 'superadmin', 'trunk_admin', 'sales_rep')
    OR public.is_my_partner()
  );


-- ── trunk_show_spiffs ──────────────────────────────────────────
DROP POLICY IF EXISTS trunk_show_spiffs_read ON trunk_show_spiffs;
CREATE POLICY trunk_show_spiffs_read ON trunk_show_spiffs
  FOR SELECT TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
    OR EXISTS (
      SELECT 1 FROM trunk_shows ts
      WHERE ts.id = trunk_show_spiffs.trunk_show_id
        AND ts.assigned_rep_id = public.get_effective_user_id()
    )
  );

DROP POLICY IF EXISTS trunk_show_spiffs_write ON trunk_show_spiffs;
CREATE POLICY trunk_show_spiffs_write ON trunk_show_spiffs
  FOR ALL TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
  )
  WITH CHECK (
    public.has_any_role('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
  );


-- ── spiff_config ───────────────────────────────────────────────
-- (spiff_config_read is `USING (TRUE)` — no role check, untouched)
DROP POLICY IF EXISTS spiff_config_write ON spiff_config;
CREATE POLICY spiff_config_write ON spiff_config
  FOR ALL TO authenticated
  USING (public.has_any_role('admin', 'superadmin', 'trunk_admin'))
  WITH CHECK (public.has_any_role('admin', 'superadmin', 'trunk_admin'));


-- ── sales_rep_territories ──────────────────────────────────────
DROP POLICY IF EXISTS sales_rep_territories_read ON sales_rep_territories;
CREATE POLICY sales_rep_territories_read ON sales_rep_territories
  FOR SELECT TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin', 'sales_rep')
    OR public.is_my_partner()
  );

DROP POLICY IF EXISTS sales_rep_territories_write ON sales_rep_territories;
CREATE POLICY sales_rep_territories_write ON sales_rep_territories
  FOR ALL TO authenticated
  USING (public.has_any_role('admin', 'superadmin') OR public.is_my_partner())
  WITH CHECK (public.has_any_role('admin', 'superadmin') OR public.is_my_partner());


-- ── sales_rep_prospecting_notes ────────────────────────────────
DROP POLICY IF EXISTS prospecting_read ON sales_rep_prospecting_notes;
CREATE POLICY prospecting_read ON sales_rep_prospecting_notes
  FOR SELECT TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
    OR rep_user_id = public.get_effective_user_id()
  );

DROP POLICY IF EXISTS prospecting_insert ON sales_rep_prospecting_notes;
CREATE POLICY prospecting_insert ON sales_rep_prospecting_notes
  FOR INSERT TO authenticated
  WITH CHECK (
    rep_user_id = public.get_effective_user_id()
    OR public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  );

DROP POLICY IF EXISTS prospecting_update ON sales_rep_prospecting_notes;
CREATE POLICY prospecting_update ON sales_rep_prospecting_notes
  FOR UPDATE TO authenticated
  USING (
    rep_user_id = public.get_effective_user_id()
    OR public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  );

DROP POLICY IF EXISTS prospecting_delete ON sales_rep_prospecting_notes;
CREATE POLICY prospecting_delete ON sales_rep_prospecting_notes
  FOR DELETE TO authenticated
  USING (
    rep_user_id = public.get_effective_user_id()
    OR public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  );


-- ────────────────────────────────────────────────────────────────
-- Sanity check — emit a NOTICE for any policy still referencing
-- the legacy single-role helper. The function itself is left in
-- place (other code paths may still call it directly), but no
-- public.* RLS policy should still embed it.
-- ────────────────────────────────────────────────────────────────
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (qual ILIKE '%get_my_role()%' OR with_check ILIKE '%get_my_role()%')
  LOOP
    RAISE NOTICE 'STILL USES get_my_role(): %.% policy=%', r.schemaname, r.tablename, r.policyname;
  END LOOP;
END $$;


DO $$ BEGIN
  RAISE NOTICE 'Multi-role Phase 3 RLS rewrite complete.';
END $$;
