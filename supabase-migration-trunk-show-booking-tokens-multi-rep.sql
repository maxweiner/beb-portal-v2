-- ── Multi-link trunk show booking + per-QR salesperson attribution
--
-- Today there's effectively a single magic link per trunk show
-- (every "New magic link" click adds another row but the panel
-- only shows the latest). We're shifting to a model where each
-- booking link is associated with a specific store salesperson,
-- so the QR you hand to Tanya tracks Tanya's bookings and the
-- spiffs roll up against her name automatically.
--
-- Schema additions:
--   trunk_show_booking_tokens.salesperson_name  — admin-set label
--   trunk_show_booking_tokens.revoked_at        — soft-delete
--   trunk_show_appointment_slots.booking_token_id — which link
--     this booking came in on; lets future spiff queries roll up
--     by token even if the spelled-out salesperson_name changes.
--
-- The existing spiff logic uses slot.store_salesperson_name
-- (text). We don't touch that — the booking flow will prefill it
-- from the token's salesperson_name so the existing rollup
-- continues to work.
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE public.trunk_show_booking_tokens
  ADD COLUMN IF NOT EXISTS salesperson_name TEXT,
  ADD COLUMN IF NOT EXISTS revoked_at       TIMESTAMPTZ;

COMMENT ON COLUMN public.trunk_show_booking_tokens.salesperson_name IS
  'Optional store salesperson tagged on this link. Bookings made via this token get this name pre-filled on the slot for spiff attribution.';
COMMENT ON COLUMN public.trunk_show_booking_tokens.revoked_at IS
  'Soft-delete. Resolution rejects revoked tokens; the panel hides them from the active-links list.';

CREATE INDEX IF NOT EXISTS idx_trunk_show_booking_tokens_active
  ON public.trunk_show_booking_tokens (trunk_show_id) WHERE revoked_at IS NULL;

ALTER TABLE public.trunk_show_appointment_slots
  ADD COLUMN IF NOT EXISTS booking_token_id UUID NULL
    REFERENCES public.trunk_show_booking_tokens(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_trunk_show_appointment_slots_token
  ON public.trunk_show_appointment_slots (booking_token_id) WHERE booking_token_id IS NOT NULL;

-- The existing trunk_show_booking_tokens_insert policy already
-- allows admin/superadmin/trunk_admin/partner. The panel needs to
-- SELECT (list active tokens) and UPDATE (rename salesperson, set
-- revoked_at). API routes that revoke from outside still go via
-- the service role.

DROP POLICY IF EXISTS trunk_show_booking_tokens_select ON public.trunk_show_booking_tokens;
CREATE POLICY trunk_show_booking_tokens_select ON public.trunk_show_booking_tokens
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
    OR EXISTS (
      SELECT 1 FROM public.trunk_shows ts
       WHERE ts.id = trunk_show_id
         AND ts.assigned_rep_id = public.get_effective_user_id()
    )
  );

DROP POLICY IF EXISTS trunk_show_booking_tokens_update ON public.trunk_show_booking_tokens;
CREATE POLICY trunk_show_booking_tokens_update ON public.trunk_show_booking_tokens
  FOR UPDATE TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
  )
  WITH CHECK (
    public.get_my_role() IN ('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
  );

DO $$ BEGIN
  RAISE NOTICE 'Multi-link trunk-show booking installed: tokens carry salesperson_name + revoked_at, slots carry booking_token_id.';
END $$;
