-- ============================================================
-- Site-wide RLS auth-id tightening — V3 (fault-tolerant)
--
-- V2 (PR #583) aborted at `shipping_manifests` because I assumed
-- a `created_by` ownership column that doesn't exist on that table.
-- The whole shipping section's DO $$ block rolled back, and sections
-- 4.13–4.21 never ran.
--
-- V3 fixes the column assumptions on the shipping tables (the
-- ownership check is workers-on-event via the events.workers JSONB
-- array, not a column) and wraps EVERY policy attempt in its own
-- BEGIN ... EXCEPTION WHEN OTHERS ... so a single column-name
-- surprise can no longer abort the whole migration. Any failures
-- are logged via RAISE NOTICE but don't block subsequent work.
--
-- Idempotent. Safe to re-run after V1, V2, or against a clean DB.
--
-- Picks up where V2 left off: shipping (corrected), customer
-- intakes, marketing payments, pre-event readiness, buying-event
-- spiffs, welcome email log, report templates, reports v1,
-- trunk-comms phase 1.
--
-- Helpers (Section 1 + 2 of V1/V2) are NOT re-applied here — they
-- already succeeded.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 4.12 Shipping manifests — REWRITTEN (no created_by; uses the
--      events.workers JSONB pattern from the original migration)
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF to_regclass('public.shipping_manifests') IS NULL THEN
    RAISE NOTICE 'skip shipping_manifests (table missing)';
    RETURN;
  END IF;

  BEGIN
    DROP POLICY IF EXISTS shipping_manifests_read ON public.shipping_manifests;
    CREATE POLICY shipping_manifests_read
      ON public.shipping_manifests FOR SELECT TO authenticated
      USING (public.has_any_role('buyer', 'admin', 'superadmin'));
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'shipping_manifests_read skip: %', SQLERRM;
  END;

  BEGIN
    DROP POLICY IF EXISTS shipping_manifests_insert ON public.shipping_manifests;
    CREATE POLICY shipping_manifests_insert
      ON public.shipping_manifests FOR INSERT TO authenticated
      WITH CHECK (
        public.has_any_role('admin', 'superadmin')
        OR EXISTS (
          SELECT 1
          FROM public.events e
          WHERE e.id = shipping_manifests.event_id
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(COALESCE(e.workers, '[]'::jsonb)) w
              WHERE (w->>'id')::uuid = public.get_effective_user_id()
            )
        )
      );
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'shipping_manifests_insert skip: %', SQLERRM;
  END;

  BEGIN
    DROP POLICY IF EXISTS shipping_manifests_update ON public.shipping_manifests;
    CREATE POLICY shipping_manifests_update
      ON public.shipping_manifests FOR UPDATE TO authenticated
      USING (
        public.has_any_role('admin', 'superadmin')
        OR EXISTS (
          SELECT 1
          FROM public.events e
          WHERE e.id = shipping_manifests.event_id
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(COALESCE(e.workers, '[]'::jsonb)) w
              WHERE (w->>'id')::uuid = public.get_effective_user_id()
            )
        )
      )
      WITH CHECK (
        public.has_any_role('admin', 'superadmin')
        OR EXISTS (
          SELECT 1
          FROM public.events e
          WHERE e.id = shipping_manifests.event_id
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(COALESCE(e.workers, '[]'::jsonb)) w
              WHERE (w->>'id')::uuid = public.get_effective_user_id()
            )
        )
      );
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'shipping_manifests_update skip: %', SQLERRM;
  END;
END $$;


-- ─────────────────────────────────────────────────────────────
-- 4.13 Event shipments + boxes — REWRITTEN to match originals
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF to_regclass('public.event_shipments') IS NOT NULL THEN
    BEGIN
      DROP POLICY IF EXISTS shipments_read ON public.event_shipments;
      CREATE POLICY shipments_read
        ON public.event_shipments FOR SELECT TO authenticated
        USING (public.has_any_role('buyer','admin','superadmin'));
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'shipments_read skip: %', SQLERRM;
    END;
    BEGIN
      DROP POLICY IF EXISTS shipments_manage ON public.event_shipments;
      CREATE POLICY shipments_manage
        ON public.event_shipments FOR ALL TO authenticated
        USING (public.has_any_role('admin','superadmin'))
        WITH CHECK (public.has_any_role('admin','superadmin'));
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'shipments_manage skip: %', SQLERRM;
    END;
  END IF;

  IF to_regclass('public.event_shipment_boxes') IS NOT NULL THEN
    BEGIN
      DROP POLICY IF EXISTS boxes_read ON public.event_shipment_boxes;
      CREATE POLICY boxes_read
        ON public.event_shipment_boxes FOR SELECT TO authenticated
        USING (public.has_any_role('buyer','admin','superadmin'));
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'boxes_read skip: %', SQLERRM;
    END;
    BEGIN
      DROP POLICY IF EXISTS boxes_manage ON public.event_shipment_boxes;
      CREATE POLICY boxes_manage
        ON public.event_shipment_boxes FOR ALL TO authenticated
        USING (
          public.has_any_role('admin','superadmin')
          OR EXISTS (
            SELECT 1
            FROM public.event_shipments s
            JOIN public.events e ON e.id = s.event_id
            WHERE s.id = event_shipment_boxes.shipment_id
              AND EXISTS (
                SELECT 1
                FROM jsonb_array_elements(COALESCE(e.workers, '[]'::jsonb)) w
                WHERE (w->>'id')::uuid = public.get_effective_user_id()
              )
          )
        )
        WITH CHECK (
          public.has_any_role('admin','superadmin')
          OR EXISTS (
            SELECT 1
            FROM public.event_shipments s
            JOIN public.events e ON e.id = s.event_id
            WHERE s.id = event_shipment_boxes.shipment_id
              AND EXISTS (
                SELECT 1
                FROM jsonb_array_elements(COALESCE(e.workers, '[]'::jsonb)) w
                WHERE (w->>'id')::uuid = public.get_effective_user_id()
              )
          )
        );
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'boxes_manage skip: %', SQLERRM;
    END;
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────
-- 4.14 Customer intakes
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF to_regclass('public.customer_intakes') IS NULL THEN
    RAISE NOTICE 'skip customer_intakes (table missing)';
    RETURN;
  END IF;
  BEGIN
    DROP POLICY IF EXISTS "Buyers can insert intakes for their events" ON public.customer_intakes;
    CREATE POLICY "Buyers can insert intakes for their events"
      ON public.customer_intakes FOR INSERT TO authenticated
      WITH CHECK (
        public.has_any_role('admin', 'superadmin')
        OR buyer_id = public.get_effective_user_id()
      );
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'customer_intakes insert skip: %', SQLERRM;
  END;
  BEGIN
    DROP POLICY IF EXISTS "Buyers can read own intakes" ON public.customer_intakes;
    CREATE POLICY "Buyers can read own intakes"
      ON public.customer_intakes FOR SELECT TO authenticated
      USING (
        public.has_any_role('admin', 'superadmin')
        OR buyer_id = public.get_effective_user_id()
      );
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'customer_intakes select skip: %', SQLERRM;
  END;
  BEGIN
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
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'customer_intakes update skip: %', SQLERRM;
  END;
  BEGIN
    DROP POLICY IF EXISTS "Admins can delete intakes" ON public.customer_intakes;
    CREATE POLICY "Admins can delete intakes"
      ON public.customer_intakes FOR DELETE TO authenticated
      USING (public.has_any_role('admin', 'superadmin'));
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'customer_intakes delete skip: %', SQLERRM;
  END;
END $$;


-- ─────────────────────────────────────────────────────────────
-- 4.15 Marketing payments — admin-only tables, no ownership column
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF to_regclass('public.marketing_payment_methods') IS NOT NULL THEN
    BEGIN
      DROP POLICY IF EXISTS "Admins read methods" ON public.marketing_payment_methods;
      CREATE POLICY "Admins read methods"
        ON public.marketing_payment_methods FOR SELECT TO authenticated
        USING (public.has_any_role('admin', 'superadmin'));
      DROP POLICY IF EXISTS "Superadmins write methods" ON public.marketing_payment_methods;
      CREATE POLICY "Superadmins write methods"
        ON public.marketing_payment_methods FOR ALL TO authenticated
        USING (public.has_any_role('superadmin'))
        WITH CHECK (public.has_any_role('superadmin'));
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'marketing_payment_methods skip: %', SQLERRM;
    END;
  END IF;
  IF to_regclass('public.marketing_payment_types') IS NOT NULL THEN
    BEGIN
      DROP POLICY IF EXISTS "Admins read types" ON public.marketing_payment_types;
      CREATE POLICY "Admins read types"
        ON public.marketing_payment_types FOR SELECT TO authenticated
        USING (public.has_any_role('admin', 'superadmin'));
      DROP POLICY IF EXISTS "Superadmins write types" ON public.marketing_payment_types;
      CREATE POLICY "Superadmins write types"
        ON public.marketing_payment_types FOR ALL TO authenticated
        USING (public.has_any_role('superadmin'))
        WITH CHECK (public.has_any_role('superadmin'));
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'marketing_payment_types skip: %', SQLERRM;
    END;
  END IF;
  IF to_regclass('public.marketing_payments') IS NOT NULL THEN
    BEGIN
      DROP POLICY IF EXISTS "Admins manage marketing_payments" ON public.marketing_payments;
      CREATE POLICY "Admins manage marketing_payments"
        ON public.marketing_payments FOR ALL TO authenticated
        USING (public.has_any_role('admin', 'superadmin'))
        WITH CHECK (public.has_any_role('admin', 'superadmin'));
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'marketing_payments skip: %', SQLERRM;
    END;
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────
-- 4.16 Pre-event readiness
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF to_regclass('public.event_promotional_asset_orders') IS NULL THEN
    RAISE NOTICE 'skip event_promotional_asset_orders (table missing)';
    RETURN;
  END IF;
  BEGIN
    DROP POLICY IF EXISTS "promo_asset_orders_select" ON public.event_promotional_asset_orders;
    CREATE POLICY "promo_asset_orders_select"
      ON public.event_promotional_asset_orders FOR SELECT TO authenticated
      USING (
        public.has_any_role('admin', 'superadmin')
        OR public.is_my_partner()
      );
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'promo_asset_orders_select skip: %', SQLERRM;
  END;
  BEGIN
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
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'promo_asset_orders_write skip: %', SQLERRM;
  END;
END $$;


-- ─────────────────────────────────────────────────────────────
-- 4.17 Buying-event spiffs — REWRITTEN (no buyer_id column —
--      ownership-by-earner is appointment_employee_id, but that
--      references store_employees not users, so there's no clean
--      employee→user mapping for an RLS comparison. Gate on
--      admin/partner only — matches the original intent.
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF to_regclass('public.buying_event_spiff_payouts') IS NULL THEN
    RAISE NOTICE 'skip buying_event_spiff_payouts (table missing)';
    RETURN;
  END IF;
  BEGIN
    DROP POLICY IF EXISTS "buying_event_spiff_payouts_select" ON public.buying_event_spiff_payouts;
    CREATE POLICY "buying_event_spiff_payouts_select"
      ON public.buying_event_spiff_payouts FOR SELECT TO authenticated
      USING (
        public.has_any_role('admin', 'superadmin')
        OR public.is_my_partner()
      );
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'spiff_payouts_select skip: %', SQLERRM;
  END;
  BEGIN
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
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'spiff_payouts_write skip: %', SQLERRM;
  END;
END $$;


-- ─────────────────────────────────────────────────────────────
-- 4.18 Welcome email log
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF to_regclass('public.welcome_email_log') IS NULL THEN
    RAISE NOTICE 'skip welcome_email_log (table missing)';
    RETURN;
  END IF;
  BEGIN
    DROP POLICY IF EXISTS "Admins manage welcome_email_log" ON public.welcome_email_log;
    CREATE POLICY "Admins manage welcome_email_log"
      ON public.welcome_email_log FOR ALL TO authenticated
      USING (public.has_any_role('admin', 'superadmin'))
      WITH CHECK (public.has_any_role('admin', 'superadmin'));
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'welcome_email_log skip: %', SQLERRM;
  END;
END $$;


-- ─────────────────────────────────────────────────────────────
-- 4.19 Report templates
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF to_regclass('public.report_templates') IS NULL THEN
    RAISE NOTICE 'skip report_templates (table missing)';
    RETURN;
  END IF;
  BEGIN
    DROP POLICY IF EXISTS "Admins manage report_templates" ON public.report_templates;
    CREATE POLICY "Admins manage report_templates"
      ON public.report_templates FOR ALL TO authenticated
      USING (public.has_any_role('admin', 'superadmin'))
      WITH CHECK (public.has_any_role('admin', 'superadmin'));
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'report_templates skip: %', SQLERRM;
  END;
END $$;


-- ─────────────────────────────────────────────────────────────
-- 4.20 Reports v1 — guard each policy in case columns differ
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF to_regclass('public.custom_reports') IS NOT NULL THEN
    BEGIN
      DROP POLICY IF EXISTS "Admins read custom_reports" ON public.custom_reports;
      CREATE POLICY "Admins read custom_reports"
        ON public.custom_reports FOR SELECT TO authenticated
        USING (public.has_any_role('admin', 'superadmin'));
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'custom_reports_select skip: %', SQLERRM;
    END;
    BEGIN
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
    EXCEPTION WHEN OTHERS THEN
      -- If `created_by` doesn't exist, fall back to admin-only.
      RAISE NOTICE 'custom_reports_write fallback (likely no created_by column): %', SQLERRM;
      BEGIN
        DROP POLICY IF EXISTS "Creators and superadmins write custom_reports" ON public.custom_reports;
        CREATE POLICY "Creators and superadmins write custom_reports"
          ON public.custom_reports FOR ALL TO authenticated
          USING (public.has_any_role('admin','superadmin'))
          WITH CHECK (public.has_any_role('admin','superadmin'));
      EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'custom_reports fallback skip: %', SQLERRM;
      END;
    END;
  END IF;

  IF to_regclass('public.custom_report_pins') IS NOT NULL THEN
    BEGIN
      DROP POLICY IF EXISTS "Users manage own custom_report_pins" ON public.custom_report_pins;
      CREATE POLICY "Users manage own custom_report_pins"
        ON public.custom_report_pins FOR ALL TO authenticated
        USING (user_id = public.get_effective_user_id())
        WITH CHECK (user_id = public.get_effective_user_id());
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'custom_report_pins skip: %', SQLERRM;
    END;
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────
-- 4.21 Trunk-comms phase 1
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF to_regclass('public.communication_templates') IS NOT NULL THEN
    BEGIN
      DROP POLICY IF EXISTS "comm_templates_select" ON public.communication_templates;
      CREATE POLICY "comm_templates_select"
        ON public.communication_templates FOR SELECT TO authenticated
        USING (public.is_trunk_comms_admin());
      DROP POLICY IF EXISTS "comm_templates_write" ON public.communication_templates;
      CREATE POLICY "comm_templates_write"
        ON public.communication_templates FOR ALL TO authenticated
        USING (public.is_trunk_comms_admin())
        WITH CHECK (public.is_trunk_comms_admin());
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'comm_templates skip: %', SQLERRM;
    END;
  END IF;
  IF to_regclass('public.communication_send_schedules') IS NOT NULL THEN
    BEGIN
      DROP POLICY IF EXISTS "comm_schedules_select" ON public.communication_send_schedules;
      CREATE POLICY "comm_schedules_select"
        ON public.communication_send_schedules FOR SELECT TO authenticated
        USING (public.is_trunk_comms_admin());
      DROP POLICY IF EXISTS "comm_schedules_write" ON public.communication_send_schedules;
      CREATE POLICY "comm_schedules_write"
        ON public.communication_send_schedules FOR ALL TO authenticated
        USING (public.is_trunk_comms_admin())
        WITH CHECK (public.is_trunk_comms_admin());
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'comm_schedules skip: %', SQLERRM;
    END;
  END IF;
  IF to_regclass('public.communication_sends') IS NOT NULL THEN
    BEGIN
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
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'comm_sends skip: %', SQLERRM;
    END;
  END IF;
  IF to_regclass('public.trunk_show_checklist_master') IS NOT NULL THEN
    BEGIN
      DROP POLICY IF EXISTS "checklist_master_select" ON public.trunk_show_checklist_master;
      CREATE POLICY "checklist_master_select"
        ON public.trunk_show_checklist_master FOR SELECT TO authenticated
        USING (public.is_trunk_comms_admin());
      DROP POLICY IF EXISTS "checklist_master_write" ON public.trunk_show_checklist_master;
      CREATE POLICY "checklist_master_write"
        ON public.trunk_show_checklist_master FOR ALL TO authenticated
        USING (public.is_trunk_comms_admin())
        WITH CHECK (public.is_trunk_comms_admin());
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'checklist_master skip: %', SQLERRM;
    END;
  END IF;
  IF to_regclass('public.trunk_show_checklist_items') IS NOT NULL THEN
    BEGIN
      DROP POLICY IF EXISTS "checklist_items_select" ON public.trunk_show_checklist_items;
      CREATE POLICY "checklist_items_select"
        ON public.trunk_show_checklist_items FOR SELECT TO authenticated
        USING (public.is_trunk_comms_admin());
      DROP POLICY IF EXISTS "checklist_items_write" ON public.trunk_show_checklist_items;
      CREATE POLICY "checklist_items_write"
        ON public.trunk_show_checklist_items FOR ALL TO authenticated
        USING (public.is_trunk_comms_admin())
        WITH CHECK (public.is_trunk_comms_admin());
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'checklist_items skip: %', SQLERRM;
    END;
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  RAISE NOTICE 'V3 complete. Any per-policy `skip: …` notices above indicate sections that need follow-up (column-name or table-shape divergences from the migration files in the repo).';
END $$;
