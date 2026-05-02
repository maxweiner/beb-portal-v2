-- ============================================================
-- Impersonation ("View As") — PHASE 1.5: RLS policy patch
--
-- Phase 1 introduced two helpers in the `public` schema:
--
--   - public.get_effective_user_id() — returns the JWT's
--     impersonating_user_id claim if set, else the actor's
--     user-row id (resolved by email).
--   - public.get_my_role() — already redefined to call
--     get_effective_user_id().
--
-- Phase 1's `KNOWN GAP` flagged that every existing RLS policy
-- that did its own `WHERE u.email = auth.jwt()->>'email'` lookup
-- still ignores impersonation. This migration is the audit + fix:
-- it drops and re-creates every such policy across the codebase
-- so RLS reads honor the impersonating_user_id claim.
--
-- Mechanical rewrite rules applied:
--
--   A. Pure role checks  →  public.get_my_role() IN (...)
--   B. Identity checks   →  table.user_col = public.get_effective_user_id()
--   C. Identity-or-role  →  combined OR with both helpers
--   D. JOIN-based ownership subqueries collapsed: the JOIN
--      against `users u ON u.email = auth.jwt()->>'email'` is
--      removed entirely when the only use of `u` is identity /
--      role; the WHERE clause references the helpers directly.
--   E. JOINs that need other columns from the user row keep the
--      JOIN but switch the predicate to
--      `JOIN users u ON u.id = public.get_effective_user_id()`.
--
-- INTENTIONALLY UNTOUCHED:
--   - supabase-migration-impersonation-phase-1.sql policies
--     (impersonation_sessions / impersonation_log) — these MUST
--     resolve to the real actor, not the impersonated target,
--     so they keep the literal email lookup.
--   - public.can_manage_roles() (function, not a policy) — uses
--     a hardcoded email by design.
--   - storage.objects policies and other special-schema policies
--     are out of scope for this phase.
--
-- Safe to re-run (DROP POLICY IF EXISTS everywhere).
-- ============================================================

-- ── accounting / expense policies (re-issued from accounting-view-all-expenses) ──

-- Patched in the expense_reports + expenses sections below.

-- ── buyer_rates ────────────────────────────────────────────────

DROP POLICY IF EXISTS buyer_rates_select ON buyer_rates;
CREATE POLICY buyer_rates_select ON buyer_rates FOR SELECT TO public
  USING (
    buyer_rates.user_id = public.get_effective_user_id()
    OR public.get_my_role() IN ('admin','superadmin')
  );

DROP POLICY IF EXISTS buyer_rates_manage ON buyer_rates;
CREATE POLICY buyer_rates_manage ON buyer_rates FOR ALL TO public
  USING (public.get_my_role() IN ('admin','superadmin'))
  WITH CHECK (public.get_my_role() IN ('admin','superadmin'));

-- ── expense_reports ────────────────────────────────────────────
-- Final SELECT policy includes 'accounting' (overlay from
-- accounting-view-all-expenses.sql).

DROP POLICY IF EXISTS expense_reports_select ON expense_reports;
CREATE POLICY expense_reports_select ON expense_reports FOR SELECT TO public
  USING (
    expense_reports.user_id = public.get_effective_user_id()
    OR public.get_my_role() IN ('admin','superadmin','accounting')
  );

DROP POLICY IF EXISTS expense_reports_insert ON expense_reports;
CREATE POLICY expense_reports_insert ON expense_reports FOR INSERT TO public
  WITH CHECK (
    expense_reports.user_id = public.get_effective_user_id()
    OR public.get_my_role() IN ('admin','superadmin')
  );

-- Owner can update only while in 'active'; admin/superadmin always.
DROP POLICY IF EXISTS expense_reports_update ON expense_reports;
CREATE POLICY expense_reports_update ON expense_reports FOR UPDATE TO public
  USING (
    (expense_reports.user_id = public.get_effective_user_id() AND expense_reports.status = 'active')
    OR public.get_my_role() IN ('admin','superadmin')
  )
  WITH CHECK (
    expense_reports.user_id = public.get_effective_user_id()
    OR public.get_my_role() IN ('admin','superadmin')
  );

DROP POLICY IF EXISTS expense_reports_delete ON expense_reports;
CREATE POLICY expense_reports_delete ON expense_reports FOR DELETE TO public
  USING (public.get_my_role() IN ('admin','superadmin'));

-- ── expenses ───────────────────────────────────────────────────
-- Final SELECT policy includes 'accounting' (overlay from
-- accounting-view-all-expenses.sql).

DROP POLICY IF EXISTS expenses_select ON expenses;
CREATE POLICY expenses_select ON expenses FOR SELECT TO public
  USING (
    EXISTS (
      SELECT 1 FROM expense_reports r
      WHERE r.id = expenses.expense_report_id
        AND (
          r.user_id = public.get_effective_user_id()
          OR public.get_my_role() IN ('admin','superadmin','accounting')
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
          OR public.get_my_role() IN ('admin','superadmin')
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
          OR public.get_my_role() IN ('admin','superadmin')
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
          OR public.get_my_role() IN ('admin','superadmin')
        )
    )
  );

-- ── compensation_invoices ──────────────────────────────────────

DROP POLICY IF EXISTS compensation_invoices_select ON compensation_invoices;
CREATE POLICY compensation_invoices_select ON compensation_invoices FOR SELECT TO public
  USING (
    compensation_invoices.user_id = public.get_effective_user_id()
    OR public.get_my_role() IN ('admin','superadmin')
  );

DROP POLICY IF EXISTS compensation_invoices_insert ON compensation_invoices;
CREATE POLICY compensation_invoices_insert ON compensation_invoices FOR INSERT TO public
  WITH CHECK (
    compensation_invoices.user_id = public.get_effective_user_id()
    OR public.get_my_role() IN ('admin','superadmin')
  );

DROP POLICY IF EXISTS compensation_invoices_update ON compensation_invoices;
CREATE POLICY compensation_invoices_update ON compensation_invoices FOR UPDATE TO public
  USING (
    (compensation_invoices.user_id = public.get_effective_user_id() AND compensation_invoices.status = 'active')
    OR public.get_my_role() IN ('admin','superadmin')
  )
  WITH CHECK (
    compensation_invoices.user_id = public.get_effective_user_id()
    OR public.get_my_role() IN ('admin','superadmin')
  );

DROP POLICY IF EXISTS compensation_invoices_delete ON compensation_invoices;
CREATE POLICY compensation_invoices_delete ON compensation_invoices FOR DELETE TO public
  USING (public.get_my_role() IN ('admin','superadmin'));

-- ── compensation_line_items ────────────────────────────────────

DROP POLICY IF EXISTS compensation_line_items_select ON compensation_line_items;
CREATE POLICY compensation_line_items_select ON compensation_line_items FOR SELECT TO public
  USING (
    EXISTS (
      SELECT 1 FROM compensation_invoices ci
      WHERE ci.id = compensation_line_items.compensation_invoice_id
        AND (
          ci.user_id = public.get_effective_user_id()
          OR public.get_my_role() IN ('admin','superadmin')
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
          OR public.get_my_role() IN ('admin','superadmin')
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
          OR public.get_my_role() IN ('admin','superadmin')
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
          OR public.get_my_role() IN ('admin','superadmin')
        )
    )
  );

-- ── expense_report_templates ───────────────────────────────────

DROP POLICY IF EXISTS templates_select ON expense_report_templates;
CREATE POLICY templates_select ON expense_report_templates FOR SELECT TO public
  USING (public.get_effective_user_id() IS NOT NULL);

-- Per spec: only partners create / edit / delete templates. is_partner
-- needs the user row, so keep the JOIN but pivot the predicate.
DROP POLICY IF EXISTS templates_manage ON expense_report_templates;
CREATE POLICY templates_manage ON expense_report_templates FOR ALL TO public
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = public.get_effective_user_id() AND u.is_partner IS TRUE
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = public.get_effective_user_id() AND u.is_partner IS TRUE
    )
  );

-- ── event_shipment_boxes ───────────────────────────────────────

DROP POLICY IF EXISTS boxes_manage ON event_shipment_boxes;
CREATE POLICY boxes_manage ON event_shipment_boxes FOR ALL TO public
  USING (
    public.get_my_role() IN ('admin','superadmin')
    OR EXISTS (
      SELECT 1
      FROM event_shipments s
      JOIN events e ON e.id = s.event_id
      WHERE s.id = event_shipment_boxes.shipment_id
        AND e.workers @> jsonb_build_array(jsonb_build_object('id', public.get_effective_user_id()::text))
    )
  )
  WITH CHECK (
    public.get_my_role() IN ('admin','superadmin')
    OR EXISTS (
      SELECT 1
      FROM event_shipments s
      JOIN events e ON e.id = s.event_id
      WHERE s.id = event_shipment_boxes.shipment_id
        AND e.workers @> jsonb_build_array(jsonb_build_object('id', public.get_effective_user_id()::text))
    )
  );

-- ── shipping_manifests ─────────────────────────────────────────
-- Final state matches shipping-manifests-event-scope.sql (event-keyed).

DROP POLICY IF EXISTS shipping_manifests_insert ON shipping_manifests;
CREATE POLICY shipping_manifests_insert ON shipping_manifests FOR INSERT TO public
  WITH CHECK (
    public.get_my_role() IN ('admin','superadmin')
    OR EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = shipping_manifests.event_id
        AND e.workers @> jsonb_build_array(jsonb_build_object('id', public.get_effective_user_id()::text))
    )
  );

DROP POLICY IF EXISTS shipping_manifests_update ON shipping_manifests;
CREATE POLICY shipping_manifests_update ON shipping_manifests FOR UPDATE TO public
  USING (
    public.get_my_role() IN ('admin','superadmin')
    OR EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = shipping_manifests.event_id
        AND e.workers @> jsonb_build_array(jsonb_build_object('id', public.get_effective_user_id()::text))
    )
  );

-- ── marketing_payment_methods ──────────────────────────────────

DROP POLICY IF EXISTS "Admins read methods" ON marketing_payment_methods;
CREATE POLICY "Admins read methods"
  ON marketing_payment_methods FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin','superadmin'));

DROP POLICY IF EXISTS "Superadmins write methods" ON marketing_payment_methods;
CREATE POLICY "Superadmins write methods"
  ON marketing_payment_methods FOR ALL TO authenticated
  USING (public.get_my_role() = 'superadmin')
  WITH CHECK (public.get_my_role() = 'superadmin');

-- ── marketing_payment_types (guarded — table may not exist) ────
-- supabase-migration-marketing-payments.sql defines this table but
-- it's never been applied in some environments. Skip silently if
-- absent; if the table is created later, re-running this migration
-- installs the policies.

DO $$
BEGIN
  IF to_regclass('public.marketing_payment_types') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Admins read types" ON marketing_payment_types';
    EXECUTE $p$CREATE POLICY "Admins read types"
      ON marketing_payment_types FOR SELECT TO authenticated
      USING (public.get_my_role() IN ('admin','superadmin'))$p$;
    EXECUTE 'DROP POLICY IF EXISTS "Superadmins write types" ON marketing_payment_types';
    EXECUTE $p$CREATE POLICY "Superadmins write types"
      ON marketing_payment_types FOR ALL TO authenticated
      USING (public.get_my_role() = 'superadmin')
      WITH CHECK (public.get_my_role() = 'superadmin')$p$;
  END IF;
END $$;

-- ── marketing_payments (guarded — table may not exist) ─────────

DO $$
BEGIN
  IF to_regclass('public.marketing_payments') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Admins manage marketing_payments" ON marketing_payments';
    EXECUTE $p$CREATE POLICY "Admins manage marketing_payments"
      ON marketing_payments FOR ALL TO authenticated
      USING (public.get_my_role() IN ('admin','superadmin'))
      WITH CHECK (public.get_my_role() IN ('admin','superadmin'))$p$;
  END IF;
END $$;

-- ── custom_reports ─────────────────────────────────────────────

DROP POLICY IF EXISTS "Admins read custom_reports" ON custom_reports;
CREATE POLICY "Admins read custom_reports"
  ON custom_reports FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin','superadmin')
    AND (
      visibility = 'global'
      OR (visibility = 'store')
      OR created_by = public.get_effective_user_id()
      OR public.get_my_role() = 'superadmin'
    )
  );

DROP POLICY IF EXISTS "Creators and superadmins write custom_reports" ON custom_reports;
CREATE POLICY "Creators and superadmins write custom_reports"
  ON custom_reports FOR ALL TO authenticated
  USING (
    created_by = public.get_effective_user_id()
    OR public.get_my_role() = 'superadmin'
  )
  WITH CHECK (
    created_by = public.get_effective_user_id()
    OR public.get_my_role() = 'superadmin'
  );

-- ── custom_report_pins ─────────────────────────────────────────

DROP POLICY IF EXISTS "Users manage own custom_report_pins" ON custom_report_pins;
CREATE POLICY "Users manage own custom_report_pins"
  ON custom_report_pins FOR ALL TO authenticated
  USING (user_id = public.get_effective_user_id())
  WITH CHECK (user_id = public.get_effective_user_id());

-- ── gcal_integration_settings ──────────────────────────────────

DROP POLICY IF EXISTS "Admins read gcal_integration_settings" ON gcal_integration_settings;
CREATE POLICY "Admins read gcal_integration_settings"
  ON gcal_integration_settings FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin','superadmin'));

DROP POLICY IF EXISTS "Superadmins write gcal_integration_settings" ON gcal_integration_settings;
CREATE POLICY "Superadmins write gcal_integration_settings"
  ON gcal_integration_settings FOR ALL TO authenticated
  USING (public.get_my_role() = 'superadmin')
  WITH CHECK (public.get_my_role() = 'superadmin');

-- ── gcal_event_links ───────────────────────────────────────────

DROP POLICY IF EXISTS "Admins read gcal_event_links" ON gcal_event_links;
CREATE POLICY "Admins read gcal_event_links"
  ON gcal_event_links FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin','superadmin'));

-- ── gcal_sync_queue ────────────────────────────────────────────

DROP POLICY IF EXISTS "Admins read gcal_sync_queue" ON gcal_sync_queue;
CREATE POLICY "Admins read gcal_sync_queue"
  ON gcal_sync_queue FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin','superadmin'));

-- ── qr_campaign_sends ──────────────────────────────────────────

DROP POLICY IF EXISTS "Admins read qr_campaign_sends" ON qr_campaign_sends;
CREATE POLICY "Admins read qr_campaign_sends"
  ON qr_campaign_sends FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin','superadmin'));

DROP POLICY IF EXISTS "Superadmins write qr_campaign_sends" ON qr_campaign_sends;
CREATE POLICY "Superadmins write qr_campaign_sends"
  ON qr_campaign_sends FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin','superadmin'))
  WITH CHECK (public.get_my_role() IN ('admin','superadmin'));

-- ── notification_templates ─────────────────────────────────────

DROP POLICY IF EXISTS "Admins read notification_templates" ON notification_templates;
CREATE POLICY "Admins read notification_templates"
  ON notification_templates FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin','superadmin'));

DROP POLICY IF EXISTS "Superadmins write notification_templates" ON notification_templates;
CREATE POLICY "Superadmins write notification_templates"
  ON notification_templates FOR ALL TO authenticated
  USING (public.get_my_role() = 'superadmin')
  WITH CHECK (public.get_my_role() = 'superadmin');

-- ── scheduled_notifications ────────────────────────────────────

DROP POLICY IF EXISTS "Admins read scheduled_notifications" ON scheduled_notifications;
CREATE POLICY "Admins read scheduled_notifications"
  ON scheduled_notifications FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin','superadmin'));

DROP POLICY IF EXISTS "Superadmins write scheduled_notifications" ON scheduled_notifications;
CREATE POLICY "Superadmins write scheduled_notifications"
  ON scheduled_notifications FOR ALL TO authenticated
  USING (public.get_my_role() = 'superadmin')
  WITH CHECK (public.get_my_role() = 'superadmin');

-- ── notification_settings ──────────────────────────────────────

DROP POLICY IF EXISTS "Admins read notification_settings" ON notification_settings;
CREATE POLICY "Admins read notification_settings"
  ON notification_settings FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin','superadmin'));

DROP POLICY IF EXISTS "Superadmins write notification_settings" ON notification_settings;
CREATE POLICY "Superadmins write notification_settings"
  ON notification_settings FOR ALL TO authenticated
  USING (public.get_my_role() = 'superadmin')
  WITH CHECK (public.get_my_role() = 'superadmin');

-- ── welcome_email_log ──────────────────────────────────────────

DROP POLICY IF EXISTS "Admins manage welcome_email_log" ON welcome_email_log;
CREATE POLICY "Admins manage welcome_email_log"
  ON welcome_email_log FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin','superadmin'))
  WITH CHECK (public.get_my_role() IN ('admin','superadmin'));

-- ── notification_queue ─────────────────────────────────────────

DROP POLICY IF EXISTS "Admins read notification_queue" ON notification_queue;
CREATE POLICY "Admins read notification_queue"
  ON notification_queue FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin','superadmin'));

-- ── report_templates ───────────────────────────────────────────

DROP POLICY IF EXISTS "Admins manage report_templates" ON report_templates;
CREATE POLICY "Admins manage report_templates"
  ON report_templates FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin','superadmin'))
  WITH CHECK (public.get_my_role() IN ('admin','superadmin'));

-- ── store_groups ───────────────────────────────────────────────

DROP POLICY IF EXISTS "Admins manage store_groups" ON store_groups;
CREATE POLICY "Admins manage store_groups"
  ON store_groups FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin','superadmin'))
  WITH CHECK (public.get_my_role() IN ('admin','superadmin'));

-- ── store_group_members ────────────────────────────────────────

DROP POLICY IF EXISTS "Admins manage store_group_members" ON store_group_members;
CREATE POLICY "Admins manage store_group_members"
  ON store_group_members FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin','superadmin'))
  WITH CHECK (public.get_my_role() IN ('admin','superadmin'));

-- ── qr_codes ───────────────────────────────────────────────────

DROP POLICY IF EXISTS "Admins manage qr_codes" ON qr_codes;
CREATE POLICY "Admins manage qr_codes"
  ON qr_codes FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin','superadmin'))
  WITH CHECK (public.get_my_role() IN ('admin','superadmin'));

-- ── qr_scans ───────────────────────────────────────────────────

DROP POLICY IF EXISTS "Admins read qr_scans" ON qr_scans;
CREATE POLICY "Admins read qr_scans"
  ON qr_scans FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin','superadmin'));

-- ── event_booking_overrides ────────────────────────────────────

DROP POLICY IF EXISTS "Admins manage event_booking_overrides" ON event_booking_overrides;
CREATE POLICY "Admins manage event_booking_overrides"
  ON event_booking_overrides FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin','superadmin'))
  WITH CHECK (public.get_my_role() IN ('admin','superadmin'));

-- ── slot_blocks ────────────────────────────────────────────────

DROP POLICY IF EXISTS "Admins manage slot_blocks" ON slot_blocks;
CREATE POLICY "Admins manage slot_blocks"
  ON slot_blocks FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin','superadmin'))
  WITH CHECK (public.get_my_role() IN ('admin','superadmin'));

-- ── appointments ───────────────────────────────────────────────

DROP POLICY IF EXISTS "Admins manage appointments" ON appointments;
CREATE POLICY "Admins manage appointments"
  ON appointments FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin','superadmin'))
  WITH CHECK (public.get_my_role() IN ('admin','superadmin'));

-- ── notification_log ───────────────────────────────────────────

DROP POLICY IF EXISTS "Admins read notification_log" ON notification_log;
CREATE POLICY "Admins read notification_log"
  ON notification_log FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin','superadmin'));

-- ── hot_show_alerts ────────────────────────────────────────────

DROP POLICY IF EXISTS "Admins read hot_show_alerts" ON hot_show_alerts;
CREATE POLICY "Admins read hot_show_alerts"
  ON hot_show_alerts FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin','superadmin'));

-- ── booking_config ─────────────────────────────────────────────

DROP POLICY IF EXISTS "Admins manage booking_config" ON booking_config;
CREATE POLICY "Admins manage booking_config"
  ON booking_config FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin','superadmin'))
  WITH CHECK (public.get_my_role() IN ('admin','superadmin'));

-- ── appointment_employees (guarded — table may not exist) ─────

DO $$
BEGIN
  IF to_regclass('public.appointment_employees') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Admins manage appointment_employees" ON appointment_employees';
    EXECUTE $p$CREATE POLICY "Admins manage appointment_employees"
      ON appointment_employees FOR ALL TO authenticated
      USING (public.get_my_role() IN ('admin','superadmin'))
      WITH CHECK (public.get_my_role() IN ('admin','superadmin'))$p$;
  END IF;
END $$;

-- ── store_portal_tokens ────────────────────────────────────────

DROP POLICY IF EXISTS "Admins manage store_portal_tokens" ON store_portal_tokens;
CREATE POLICY "Admins manage store_portal_tokens"
  ON store_portal_tokens FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin','superadmin'))
  WITH CHECK (public.get_my_role() IN ('admin','superadmin'));

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
    OR public.get_my_role() IN ('admin','superadmin')
  );

DROP POLICY IF EXISTS "Buyers can update own intakes" ON customer_intakes;
CREATE POLICY "Buyers can update own intakes"
  ON customer_intakes FOR UPDATE
  TO authenticated
  USING (
    customer_intakes.buyer_id = public.get_effective_user_id()
    OR public.get_my_role() IN ('admin','superadmin')
  );

DROP POLICY IF EXISTS "Admins can delete intakes" ON customer_intakes;
CREATE POLICY "Admins can delete intakes"
  ON customer_intakes FOR DELETE
  TO authenticated
  USING (public.get_my_role() IN ('admin','superadmin'));

-- ── confirmation ───────────────────────────────────────────────

DO $$
DECLARE
  patched_count CONSTANT INT := 62;
BEGIN
  RAISE NOTICE 'Impersonation Phase 1.5 RLS patch applied. Policies patched: %.', patched_count;
END $$;
