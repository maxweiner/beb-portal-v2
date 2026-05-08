-- ── Security advisor cleanup: function search_path + EXECUTE grants
--
-- Closes ~90 of the WARN-level findings:
--   1. function_search_path_mutable (50 functions) — set explicit
--      search_path so a malicious schema in front of `public` on the
--      caller's path can't shadow trusted symbols.
--   2. anon_security_definer_function_executable (33 functions) —
--      revoke EXECUTE from anon. Nothing in our app legitimately
--      RPCs these as anon.
--   3. authenticated_security_definer_function_executable (subset) —
--      revoke EXECUTE from authenticated for trigger-only +
--      server-only helpers. The remaining authenticated-callable
--      surface is just the RLS helpers (has_any_role, get_my_role,
--      etc) and the 5 functions actually RPC'd by the app
--      (claim_due_*, compute_mail_by_date, customers_recompute_
--      engagement). Those keep EXECUTE so RLS + the app continue to
--      work; they show up as remaining warnings by design.
--
-- Defer: rls_policy_always_true findings (15 policies on 8 tables),
-- and auth_leaked_password_protection (Auth UI toggle, not SQL).
-- Both will land in a follow-up once table schemas are confirmed.
--
-- Safe to re-run.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. SET search_path on every flagged function.
-- ─────────────────────────────────────────────────────────────

ALTER FUNCTION public.claim_due_notifications()                                    SET search_path = public, pg_temp;
ALTER FUNCTION public.touch_promo_asset_order_updated_at()                         SET search_path = public, pg_temp;
ALTER FUNCTION public.touch_event_waitlist_updated_at()                            SET search_path = public, pg_temp;
ALTER FUNCTION public.customers_buyer_has_event_access(p_store_id uuid)            SET search_path = public, pg_temp;
ALTER FUNCTION public.touch_trunk_comms_updated_at()                               SET search_path = public, pg_temp;
ALTER FUNCTION public.is_trunk_comms_admin()                                       SET search_path = public, pg_temp;
ALTER FUNCTION public.is_assigned_trunk_show_rep()                                 SET search_path = public, pg_temp;
ALTER FUNCTION public.enqueue_gcal_sync()                                          SET search_path = public, pg_temp;
ALTER FUNCTION public.claim_due_gcal_syncs()                                       SET search_path = public, pg_temp;
ALTER FUNCTION public.touch_totals_on_comp_change()                                SET search_path = public, pg_temp;
ALTER FUNCTION public.recompute_expense_report_totals(p_report_id uuid)            SET search_path = public, pg_temp;
ALTER FUNCTION public.marketing_set_updated_at()                                   SET search_path = public, pg_temp;
ALTER FUNCTION public.has_marketing_access()                                       SET search_path = public, pg_temp;
ALTER FUNCTION public.create_event_shipment()                                      SET search_path = public, pg_temp;
ALTER FUNCTION public.resync_event_shipment_date()                                 SET search_path = public, pg_temp;
ALTER FUNCTION public.touch_updated_at()                                           SET search_path = public, pg_temp;
ALTER FUNCTION public.customers_set_updated_at()                                   SET search_path = public, pg_temp;
ALTER FUNCTION public.sync_shipment_boxes(p_shipment_id uuid)                      SET search_path = public, pg_temp;
ALTER FUNCTION public.spawn_shipment_boxes_trigger()                               SET search_path = public, pg_temp;
ALTER FUNCTION public.resync_shipment_boxes_trigger()                              SET search_path = public, pg_temp;
ALTER FUNCTION public.compute_mail_by_date()                                       SET search_path = public, pg_temp;
ALTER FUNCTION public.customers_recompute_engagement(p_active_days integer, p_lapsed_days integer, p_vip_threshold integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.customers_actor_is_admin()                                   SET search_path = public, pg_temp;
ALTER FUNCTION public.touch_booking_config_updated_at()                            SET search_path = public, pg_temp;
ALTER FUNCTION public.resync_store_shipments()                                     SET search_path = public, pg_temp;
ALTER FUNCTION public.touch_event_booking_overrides_updated_at()                   SET search_path = public, pg_temp;
ALTER FUNCTION public.touch_appointments_updated_at()                              SET search_path = public, pg_temp;
ALTER FUNCTION public.shipment_reminder_payload(p_shipment_id uuid)                SET search_path = public, pg_temp;
ALTER FUNCTION public.enqueue_shipping_reminders(p_shipment_id uuid)               SET search_path = public, pg_temp;
ALTER FUNCTION public.cancel_shipping_reminders(p_event_id uuid, p_reason text)    SET search_path = public, pg_temp;
ALTER FUNCTION public.trg_enqueue_shipment_reminders()                             SET search_path = public, pg_temp;
ALTER FUNCTION public.trg_resync_shipment_reminders()                              SET search_path = public, pg_temp;
ALTER FUNCTION public.trg_resync_store_shipping_recipients()                       SET search_path = public, pg_temp;
ALTER FUNCTION public.roles_set_updated_at()                                       SET search_path = public, pg_temp;
ALTER FUNCTION public.can_manage_roles()                                           SET search_path = public, pg_temp;
ALTER FUNCTION public.customers_log_tier_change()                                  SET search_path = public, pg_temp;
ALTER FUNCTION public.touch_expense_report_totals()                                SET search_path = public, pg_temp;
ALTER FUNCTION public.seed_expense_from_reservation()                              SET search_path = public, pg_temp;
ALTER FUNCTION public.cleanup_expense_for_deleted_reservation()                    SET search_path = public, pg_temp;
ALTER FUNCTION public.marketing_campaigns_block_buyer_fields_for_marketing_role()  SET search_path = public, pg_temp;
ALTER FUNCTION public.touch_totals_on_bonus_change()                               SET search_path = public, pg_temp;
ALTER FUNCTION public.claim_due_trunk_show_syncs()                                 SET search_path = public, pg_temp;
ALTER FUNCTION public.is_active()                                                  SET search_path = public, pg_temp;
ALTER FUNCTION public.enqueue_trunk_show_gcal_sync()                               SET search_path = public, pg_temp;
ALTER FUNCTION public.create_schedule_checklist_item(p_trunk_show_id uuid, p_template_id uuid, p_due_date date) SET search_path = public, pg_temp;
ALTER FUNCTION public.fanout_schedules_on_trunk_show_insert()                      SET search_path = public, pg_temp;
ALTER FUNCTION public.fanout_trunk_shows_on_schedule_change()                      SET search_path = public, pg_temp;
ALTER FUNCTION public.fanout_master_checklist_on_trunk_show_insert()               SET search_path = public, pg_temp;
ALTER FUNCTION public.set_default_comp_rate()                                      SET search_path = public, pg_temp;
ALTER FUNCTION public.events_block_overlap_per_store()                             SET search_path = public, pg_temp;

-- ─────────────────────────────────────────────────────────────
-- 2. Revoke EXECUTE from anon on every flagged SECURITY DEFINER
--    function. None of these are legitimately reachable from anon
--    (the public booking form uses dedicated server-side API
--    routes, not RPC).
-- ─────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.can_manage_roles()                                              FROM anon;
REVOKE EXECUTE ON FUNCTION public.cancel_shipping_reminders(p_event_id uuid, p_reason text)       FROM anon;
REVOKE EXECUTE ON FUNCTION public.cleanup_expense_for_deleted_reservation()                       FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_event_shipment()                                         FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_schedule_checklist_item(p_trunk_show_id uuid, p_template_id uuid, p_due_date date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.customers_actor_is_admin()                                      FROM anon;
REVOKE EXECUTE ON FUNCTION public.customers_buyer_has_event_access(p_store_id uuid)               FROM anon;
REVOKE EXECUTE ON FUNCTION public.customers_recompute_engagement(p_active_days integer, p_lapsed_days integer, p_vip_threshold integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.enqueue_gcal_sync()                                             FROM anon;
REVOKE EXECUTE ON FUNCTION public.enqueue_shipping_reminders(p_shipment_id uuid)                  FROM anon;
REVOKE EXECUTE ON FUNCTION public.enqueue_trunk_show_gcal_sync()                                  FROM anon;
REVOKE EXECUTE ON FUNCTION public.fanout_master_checklist_on_trunk_show_insert()                  FROM anon;
REVOKE EXECUTE ON FUNCTION public.fanout_schedules_on_trunk_show_insert()                         FROM anon;
REVOKE EXECUTE ON FUNCTION public.fanout_trunk_shows_on_schedule_change()                         FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_effective_user_id()                                         FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_role()                                                   FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_roles()                                                  FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_any_role(VARIADIC roles text[])                             FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_marketing_access()                                          FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_active()                                                     FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_my_partner()                                                 FROM anon;
REVOKE EXECUTE ON FUNCTION public.marketing_campaigns_block_buyer_fields_for_marketing_role()     FROM anon;
REVOKE EXECUTE ON FUNCTION public.recompute_expense_report_totals(p_report_id uuid)               FROM anon;
REVOKE EXECUTE ON FUNCTION public.resync_event_shipment_date()                                    FROM anon;
REVOKE EXECUTE ON FUNCTION public.resync_shipment_boxes_trigger()                                 FROM anon;
REVOKE EXECUTE ON FUNCTION public.resync_store_shipments()                                        FROM anon;
REVOKE EXECUTE ON FUNCTION public.seed_expense_from_reservation()                                 FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_default_comp_rate()                                         FROM anon;
REVOKE EXECUTE ON FUNCTION public.shipment_reminder_payload(p_shipment_id uuid)                   FROM anon;
REVOKE EXECUTE ON FUNCTION public.spawn_shipment_boxes_trigger()                                  FROM anon;
REVOKE EXECUTE ON FUNCTION public.sync_shipment_boxes(p_shipment_id uuid)                         FROM anon;
REVOKE EXECUTE ON FUNCTION public.sync_user_role_to_user_roles()                                  FROM anon;
REVOKE EXECUTE ON FUNCTION public.trg_enqueue_shipment_reminders()                                FROM anon;
REVOKE EXECUTE ON FUNCTION public.trg_resync_shipment_reminders()                                 FROM anon;
REVOKE EXECUTE ON FUNCTION public.trg_resync_store_shipping_recipients()                          FROM anon;

-- ─────────────────────────────────────────────────────────────
-- 3. Revoke EXECUTE from authenticated on functions that are NOT
--    legitimate RPC targets. These are either:
--      • Trigger functions — fired via the table's trigger as the
--        table owner; EXECUTE to the JWT role is irrelevant.
--      • Server-only helpers — invoked via the service role (which
--        bypasses GRANTs). Keeping authenticated EXECUTE on them
--        just hands a backdoor to any signed-in user.
--
--    KEPT for authenticated:
--      • RLS helpers — has_any_role, get_my_role, get_my_roles,
--        is_my_partner, get_effective_user_id, is_active,
--        has_marketing_access, customers_actor_is_admin,
--        can_manage_roles, customers_buyer_has_event_access,
--        is_trunk_comms_admin, is_assigned_trunk_show_rep
--      • App-RPC'd — claim_due_gcal_syncs, claim_due_notifications,
--        claim_due_trunk_show_syncs, compute_mail_by_date,
--        customers_recompute_engagement
-- ─────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.cancel_shipping_reminders(p_event_id uuid, p_reason text)       FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_expense_for_deleted_reservation()                       FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.create_event_shipment()                                         FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.create_schedule_checklist_item(p_trunk_show_id uuid, p_template_id uuid, p_due_date date) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_gcal_sync()                                             FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_shipping_reminders(p_shipment_id uuid)                  FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_trunk_show_gcal_sync()                                  FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.fanout_master_checklist_on_trunk_show_insert()                  FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.fanout_schedules_on_trunk_show_insert()                         FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.fanout_trunk_shows_on_schedule_change()                         FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.marketing_campaigns_block_buyer_fields_for_marketing_role()     FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.recompute_expense_report_totals(p_report_id uuid)               FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.resync_event_shipment_date()                                    FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.resync_shipment_boxes_trigger()                                 FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.resync_store_shipments()                                        FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.seed_expense_from_reservation()                                 FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.set_default_comp_rate()                                         FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.shipment_reminder_payload(p_shipment_id uuid)                   FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.spawn_shipment_boxes_trigger()                                  FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_shipment_boxes(p_shipment_id uuid)                         FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_user_role_to_user_roles()                                  FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_enqueue_shipment_reminders()                                FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_resync_shipment_reminders()                                 FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_resync_store_shipping_recipients()                          FROM authenticated;

DO $$ BEGIN
  RAISE NOTICE 'Search-path + EXECUTE cleanup applied. ~90 advisor warnings should clear.';
  RAISE NOTICE 'Remaining: rls_policy_always_true (15) + auth_leaked_password_protection — handled in follow-up.';
END $$;
