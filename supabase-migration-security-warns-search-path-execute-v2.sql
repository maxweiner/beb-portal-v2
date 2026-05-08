-- ── Security advisor cleanup v2 — uses dynamic SQL to discover
-- ── each function's actual signature so we don't have to keep
-- ── them in sync with this file by hand.
--
-- Replaces v1 (which broke on functions whose signature wasn't
-- the one shown in the advisor — e.g. claim_due_notifications
-- actually takes a batch_size argument).
--
-- Iterates pg_proc.pg_get_function_identity_arguments to build the
-- exact ALTER / REVOKE statement for every overload of each named
-- function. Functions that don't exist are skipped silently.
--
-- Same three-pass logic as v1:
--   1. SET search_path on every flagged function
--   2. REVOKE EXECUTE FROM anon on every SECURITY DEFINER fn
--   3. REVOKE EXECUTE FROM authenticated on trigger/server-only fns
--      (RLS helpers + the 5 explicitly RPC'd functions keep their
--       authenticated EXECUTE so the app stays working)
--
-- Safe to re-run.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. SET search_path on every flagged function
-- ─────────────────────────────────────────────────────────────

DO $$
DECLARE
  target_names text[] := ARRAY[
    'claim_due_notifications',
    'touch_promo_asset_order_updated_at',
    'touch_event_waitlist_updated_at',
    'customers_buyer_has_event_access',
    'touch_trunk_comms_updated_at',
    'is_trunk_comms_admin',
    'is_assigned_trunk_show_rep',
    'enqueue_gcal_sync',
    'claim_due_gcal_syncs',
    'touch_totals_on_comp_change',
    'recompute_expense_report_totals',
    'marketing_set_updated_at',
    'has_marketing_access',
    'create_event_shipment',
    'resync_event_shipment_date',
    'touch_updated_at',
    'customers_set_updated_at',
    'sync_shipment_boxes',
    'spawn_shipment_boxes_trigger',
    'resync_shipment_boxes_trigger',
    'compute_mail_by_date',
    'customers_recompute_engagement',
    'customers_actor_is_admin',
    'touch_booking_config_updated_at',
    'resync_store_shipments',
    'touch_event_booking_overrides_updated_at',
    'touch_appointments_updated_at',
    'shipment_reminder_payload',
    'enqueue_shipping_reminders',
    'cancel_shipping_reminders',
    'trg_enqueue_shipment_reminders',
    'trg_resync_shipment_reminders',
    'trg_resync_store_shipping_recipients',
    'roles_set_updated_at',
    'can_manage_roles',
    'customers_log_tier_change',
    'touch_expense_report_totals',
    'seed_expense_from_reservation',
    'cleanup_expense_for_deleted_reservation',
    'marketing_campaigns_block_buyer_fields_for_marketing_role',
    'touch_totals_on_bonus_change',
    'claim_due_trunk_show_syncs',
    'is_active',
    'enqueue_trunk_show_gcal_sync',
    'create_schedule_checklist_item',
    'fanout_schedules_on_trunk_show_insert',
    'fanout_trunk_shows_on_schedule_change',
    'fanout_master_checklist_on_trunk_show_insert',
    'set_default_comp_rate',
    'events_block_overlap_per_store'
  ];
  fn record;
BEGIN
  FOR fn IN
    SELECT
      n.nspname  AS schema_name,
      p.proname  AS func_name,
      pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (target_names)
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I.%I(%s) SET search_path = public, pg_temp',
      fn.schema_name, fn.func_name, fn.args
    );
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 2. REVOKE EXECUTE FROM anon on every SECURITY DEFINER function
--    flagged by the advisor.
-- ─────────────────────────────────────────────────────────────

DO $$
DECLARE
  target_names text[] := ARRAY[
    'can_manage_roles',
    'cancel_shipping_reminders',
    'cleanup_expense_for_deleted_reservation',
    'create_event_shipment',
    'create_schedule_checklist_item',
    'customers_actor_is_admin',
    'customers_buyer_has_event_access',
    'customers_recompute_engagement',
    'enqueue_gcal_sync',
    'enqueue_shipping_reminders',
    'enqueue_trunk_show_gcal_sync',
    'fanout_master_checklist_on_trunk_show_insert',
    'fanout_schedules_on_trunk_show_insert',
    'fanout_trunk_shows_on_schedule_change',
    'get_effective_user_id',
    'get_my_role',
    'get_my_roles',
    'has_any_role',
    'has_marketing_access',
    'is_active',
    'is_my_partner',
    'marketing_campaigns_block_buyer_fields_for_marketing_role',
    'recompute_expense_report_totals',
    'resync_event_shipment_date',
    'resync_shipment_boxes_trigger',
    'resync_store_shipments',
    'seed_expense_from_reservation',
    'set_default_comp_rate',
    'shipment_reminder_payload',
    'spawn_shipment_boxes_trigger',
    'sync_shipment_boxes',
    'sync_user_role_to_user_roles',
    'trg_enqueue_shipment_reminders',
    'trg_resync_shipment_reminders',
    'trg_resync_store_shipping_recipients'
  ];
  fn record;
BEGIN
  FOR fn IN
    SELECT
      n.nspname  AS schema_name,
      p.proname  AS func_name,
      pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (target_names)
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM anon',
      fn.schema_name, fn.func_name, fn.args
    );
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 3. REVOKE EXECUTE FROM authenticated on trigger-only and
--    server-only helpers. RLS helpers + the 5 app-RPC'd functions
--    are deliberately omitted from this list.
-- ─────────────────────────────────────────────────────────────

DO $$
DECLARE
  target_names text[] := ARRAY[
    'cancel_shipping_reminders',
    'cleanup_expense_for_deleted_reservation',
    'create_event_shipment',
    'create_schedule_checklist_item',
    'enqueue_gcal_sync',
    'enqueue_shipping_reminders',
    'enqueue_trunk_show_gcal_sync',
    'fanout_master_checklist_on_trunk_show_insert',
    'fanout_schedules_on_trunk_show_insert',
    'fanout_trunk_shows_on_schedule_change',
    'marketing_campaigns_block_buyer_fields_for_marketing_role',
    'recompute_expense_report_totals',
    'resync_event_shipment_date',
    'resync_shipment_boxes_trigger',
    'resync_store_shipments',
    'seed_expense_from_reservation',
    'set_default_comp_rate',
    'shipment_reminder_payload',
    'spawn_shipment_boxes_trigger',
    'sync_shipment_boxes',
    'sync_user_role_to_user_roles',
    'trg_enqueue_shipment_reminders',
    'trg_resync_shipment_reminders',
    'trg_resync_store_shipping_recipients'
  ];
  fn record;
BEGIN
  FOR fn IN
    SELECT
      n.nspname  AS schema_name,
      p.proname  AS func_name,
      pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (target_names)
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM authenticated',
      fn.schema_name, fn.func_name, fn.args
    );
  END LOOP;
END $$;

DO $$ BEGIN
  RAISE NOTICE 'v2 search-path + EXECUTE cleanup applied (signature-discovered). ~90 advisor warnings should clear.';
END $$;
