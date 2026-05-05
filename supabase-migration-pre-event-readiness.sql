-- ── Pre-Event readiness signals ──────────────────────────────
-- Two new readiness data points that the Pre-Event tab needs:
--
--   1. events.staff_briefed_at + staff_briefed_by_user_id —
--      timestamp + actor for "operations team has briefed the
--      buyers and stakeholders on this event." Distinct from
--      marketing_campaigns.team_notified_at (which is
--      marketing-team-only). NULL = not yet briefed.
--
--   2. event_promotional_asset_orders — per-event tracker for
--      counter cards / countertop displays / in-store postcards
--      / similar physical items the marketing/ops team orders
--      and ships ahead of the event. Granular enough to flag
--      partial completion ("3 of 4 ordered, 2 of 4 delivered")
--      without needing per-SKU detail.
--
-- Safe to re-run.
-- ============================================================

-- ── 1. events.staff_briefed_at / by ──────────────────────────
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS staff_briefed_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS staff_briefed_by_user_id UUID
    REFERENCES public.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.events.staff_briefed_at IS
  'Set when ops marks the buyers + stakeholders as briefed for this event. NULL = not yet briefed. Used by the Pre-Event readiness chip.';

COMMENT ON COLUMN public.events.staff_briefed_by_user_id IS
  'User who marked the staff as briefed. Snapshot — survives later user role changes.';

-- ── 2. event_promotional_asset_orders ───────────────────────
CREATE TABLE IF NOT EXISTS public.event_promotional_asset_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,

  -- Free-form for now. Common values: 'counter_card',
  -- 'countertop_display', 'in_store_postcard', 'window_sign',
  -- 'other'. Could be tightened to an enum later.
  asset_type TEXT NOT NULL,
  description TEXT,
  quantity INT,
  vendor TEXT,

  -- Lifecycle timestamps. NULL = not yet at that stage.
  ordered_at   TIMESTAMPTZ,
  shipped_at   TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,

  tracking_number TEXT,
  notes TEXT,

  created_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_promo_asset_orders_event
  ON public.event_promotional_asset_orders (event_id);

COMMENT ON TABLE public.event_promotional_asset_orders IS
  'Per-event tracker for physical promotional items the marketing/ops team orders and ships before the event runs. One row per discrete order; lifecycle timestamps drive the Pre-Event readiness chip color (red → yellow → green).';

ALTER TABLE public.event_promotional_asset_orders ENABLE ROW LEVEL SECURITY;

-- Reads: admin/superadmin/partner. Writes: same. Marketing role
-- gets read+write too since they typically place these orders.
DROP POLICY IF EXISTS "promo_asset_orders_select" ON public.event_promotional_asset_orders;
CREATE POLICY "promo_asset_orders_select"
  ON public.event_promotional_asset_orders FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin','superadmin','marketing')
    OR EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.email = auth.jwt()->>'email' AND u.is_partner IS TRUE
    )
  );

DROP POLICY IF EXISTS "promo_asset_orders_write" ON public.event_promotional_asset_orders;
CREATE POLICY "promo_asset_orders_write"
  ON public.event_promotional_asset_orders FOR ALL TO authenticated
  USING (
    public.get_my_role() IN ('admin','superadmin','marketing')
    OR EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.email = auth.jwt()->>'email' AND u.is_partner IS TRUE
    )
  )
  WITH CHECK (
    public.get_my_role() IN ('admin','superadmin','marketing')
    OR EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.email = auth.jwt()->>'email' AND u.is_partner IS TRUE
    )
  );

-- Touch updated_at on every UPDATE.
CREATE OR REPLACE FUNCTION public.touch_promo_asset_order_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_promo_asset_orders_touch ON public.event_promotional_asset_orders;
CREATE TRIGGER trg_promo_asset_orders_touch
BEFORE UPDATE ON public.event_promotional_asset_orders
FOR EACH ROW EXECUTE FUNCTION public.touch_promo_asset_order_updated_at();

DO $$ BEGIN
  RAISE NOTICE 'Pre-Event readiness schema installed: events.staff_briefed_at + event_promotional_asset_orders.';
END $$;
