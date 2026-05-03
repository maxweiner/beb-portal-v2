-- Grants the new 'trunk_admin' role admin-level access to all
-- trunk-show-domain tables. Mirrors what 'admin' / 'superadmin'
-- already get; doesn't touch buying-side or trade-show tables.
--
-- Pattern: replace `get_my_role() IN ('admin', 'superadmin')`
-- with `get_my_role() IN ('admin', 'superadmin', 'trunk_admin')`
-- everywhere a trunk-show-related policy uses it. is_my_partner()
-- branches stay as-is so partners keep their existing access.
--
-- Idempotent: each policy is dropped and re-created.
--
-- Tables touched:
--   trunk_shows                              (read, write)
--   trunk_show_hours                         (read, write)
--   office_staff_notification_recipients     (read, write)
--   trunk_show_special_requests              (read, insert, update)
--   trunk_show_appointment_slots             (read, write)
--   trunk_show_spiffs                        (read, write)
--   spiff_config                             (write)
--
-- Skipped:
--   trunk_show_booking_tokens — service-role-only, no policies.
--   spiff_config_read         — already TRUE for all authenticated.
--   sales_rep_territories     — sales-side, not trunk domain.

-- ── trunk_shows ────────────────────────────────────────────────
DROP POLICY IF EXISTS trunk_shows_read ON trunk_shows;
CREATE POLICY trunk_shows_read ON trunk_shows
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
    OR (public.get_my_role() = 'sales_rep'
        AND assigned_rep_id = public.get_effective_user_id())
  );

DROP POLICY IF EXISTS trunk_shows_write ON trunk_shows;
CREATE POLICY trunk_shows_write ON trunk_shows
  FOR ALL TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
    OR (public.get_my_role() = 'sales_rep'
        AND assigned_rep_id = public.get_effective_user_id())
  )
  WITH CHECK (
    public.get_my_role() IN ('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
    OR public.get_my_role() = 'sales_rep'
  );

-- ── trunk_show_hours ───────────────────────────────────────────
DROP POLICY IF EXISTS trunk_show_hours_read ON trunk_show_hours;
CREATE POLICY trunk_show_hours_read ON trunk_show_hours
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'superadmin', 'trunk_admin')
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
    public.get_my_role() IN ('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
    OR EXISTS (
      SELECT 1 FROM trunk_shows ts
      WHERE ts.id = trunk_show_hours.trunk_show_id
        AND ts.assigned_rep_id = public.get_effective_user_id()
    )
  )
  WITH CHECK (
    public.get_my_role() IN ('admin', 'superadmin', 'trunk_admin', 'sales_rep')
    OR public.is_my_partner()
  );

-- ── office_staff_notification_recipients ───────────────────────
DROP POLICY IF EXISTS osnr_read ON office_staff_notification_recipients;
CREATE POLICY osnr_read ON office_staff_notification_recipients
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
  );

DROP POLICY IF EXISTS osnr_write ON office_staff_notification_recipients;
CREATE POLICY osnr_write ON office_staff_notification_recipients
  FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin', 'superadmin', 'trunk_admin'))
  WITH CHECK (public.get_my_role() IN ('admin', 'superadmin', 'trunk_admin'));

-- ── trunk_show_special_requests ────────────────────────────────
DROP POLICY IF EXISTS special_requests_read ON trunk_show_special_requests;
CREATE POLICY special_requests_read ON trunk_show_special_requests
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'superadmin', 'trunk_admin')
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
    public.get_my_role() IN ('admin', 'superadmin', 'trunk_admin')
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
    public.get_my_role() IN ('admin', 'superadmin', 'trunk_admin')
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
    public.get_my_role() IN ('admin', 'superadmin', 'trunk_admin')
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
    public.get_my_role() IN ('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
    OR EXISTS (
      SELECT 1 FROM trunk_shows ts
      WHERE ts.id = trunk_show_appointment_slots.trunk_show_id
        AND ts.assigned_rep_id = public.get_effective_user_id()
    )
  )
  WITH CHECK (
    public.get_my_role() IN ('admin', 'superadmin', 'trunk_admin', 'sales_rep')
    OR public.is_my_partner()
  );

-- ── trunk_show_spiffs ──────────────────────────────────────────
DROP POLICY IF EXISTS trunk_show_spiffs_read ON trunk_show_spiffs;
CREATE POLICY trunk_show_spiffs_read ON trunk_show_spiffs
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'superadmin', 'trunk_admin')
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
    public.get_my_role() IN ('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
  )
  WITH CHECK (
    public.get_my_role() IN ('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
  );

-- ── spiff_config ───────────────────────────────────────────────
DROP POLICY IF EXISTS spiff_config_write ON spiff_config;
CREATE POLICY spiff_config_write ON spiff_config
  FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin', 'superadmin', 'trunk_admin'))
  WITH CHECK (public.get_my_role() IN ('admin', 'superadmin', 'trunk_admin'));
