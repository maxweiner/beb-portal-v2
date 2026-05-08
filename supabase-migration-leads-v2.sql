-- ── Leads v2: three pipelines (trade_show / buying_event / trunk_show)
-- Per the team review:
--   1. Existing leads (trade-show booth captures) keep working.
--   2. Two new lead kinds: buying-event prospects (stores BEB might
--      pitch on hosting an estate event) and trunk-show prospects
--      (stores BEB might pitch on hosting a trunk show).
--   3. Each kind has its own field set; conversion auto-creates
--      the store + a Save-the-Date event/show.
--
-- Visibility:
--   - trade_show kind: existing rules (sales reps see their own,
--     admin/superadmin/partner see all)
--   - buying_event + trunk_show kinds: admin/superadmin/partner only
--
-- Safe to re-run.
-- ============================================================

-- 1. lead_kind enum + column.
DO $$ BEGIN
  CREATE TYPE lead_kind AS ENUM ('trade_show', 'buying_event', 'trunk_show');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS lead_kind lead_kind NOT NULL DEFAULT 'trade_show';

CREATE INDEX IF NOT EXISTS idx_leads_kind ON public.leads(lead_kind, status) WHERE deleted_at IS NULL;

-- 2. Per-kind fields. NULL when not applicable to the kind.
ALTER TABLE public.leads
  -- Universal additions (used by all three kinds going forward;
  -- existing trade-show rows keep their `phone` field too).
  ADD COLUMN IF NOT EXISTS store_phone        TEXT,
  ADD COLUMN IF NOT EXISTS cell_phone         TEXT,
  ADD COLUMN IF NOT EXISTS referral_source    TEXT,
  -- Buying-event specific.
  ADD COLUMN IF NOT EXISTS best_time_of_year  TEXT,
  ADD COLUMN IF NOT EXISTS freestanding       BOOLEAN,
  ADD COLUMN IF NOT EXISTS parking            TEXT,
  ADD COLUMN IF NOT EXISTS year_established   INT,
  ADD COLUMN IF NOT EXISTS sq_footage         TEXT,
  ADD COLUMN IF NOT EXISTS currently_buys     BOOLEAN,
  -- Trunk-show specific.
  ADD COLUMN IF NOT EXISTS locking_cases       BOOLEAN,
  ADD COLUMN IF NOT EXISTS rated_safe          BOOLEAN,
  ADD COLUMN IF NOT EXISTS sales_staff_count   INT,
  ADD COLUMN IF NOT EXISTS years_in_business   INT,
  ADD COLUMN IF NOT EXISTS sells_estate_jewelry BOOLEAN,
  ADD COLUMN IF NOT EXISTS distance_to_airport_miles NUMERIC(6,1),
  -- Conversion targets — null until status flips to 'converted'.
  ADD COLUMN IF NOT EXISTS converted_store_id              UUID REFERENCES public.stores(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS converted_trunk_show_store_id   UUID REFERENCES public.trunk_show_stores(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS converted_event_id              UUID REFERENCES public.events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS converted_trunk_show_id         UUID REFERENCES public.trunk_shows(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS converted_at                    TIMESTAMPTZ;

-- Constrain enum-like text columns.
DO $$ BEGIN
  ALTER TABLE public.leads
    ADD CONSTRAINT leads_parking_check
    CHECK (parking IS NULL OR parking IN ('own_lot', 'shared_lot', 'street', 'none'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.leads
    ADD CONSTRAINT leads_sq_footage_check
    CHECK (sq_footage IS NULL OR sq_footage IN ('small', 'medium', 'large'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Add 'reserved' status to trunk_show_status enum so the
--    "convert lead → Save-the-Date trunk show" path works
--    parallel to buying-event reservations.
DO $$ BEGIN
  ALTER TYPE trunk_show_status ADD VALUE IF NOT EXISTS 'reserved' BEFORE 'scheduled';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4. RLS — extend the existing leads_select to allow buying_event +
--    trunk_show kinds for admin/superadmin/partner; sales reps
--    keep seeing only their assigned trade_show leads.
DROP POLICY IF EXISTS leads_select ON public.leads;
CREATE POLICY leads_select ON public.leads
  FOR SELECT TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
    OR (
      public.has_any_role('sales_rep')
      AND lead_kind = 'trade_show'
      AND (
        leads.assigned_rep_id     = public.get_effective_user_id()
        OR leads.captured_by_user_id = public.get_effective_user_id()
      )
    )
  );

DROP POLICY IF EXISTS leads_insert ON public.leads;
CREATE POLICY leads_insert ON public.leads
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
    OR (public.has_any_role('sales_rep') AND lead_kind = 'trade_show')
  );

DROP POLICY IF EXISTS leads_update ON public.leads;
CREATE POLICY leads_update ON public.leads
  FOR UPDATE TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
    OR (
      public.has_any_role('sales_rep')
      AND lead_kind = 'trade_show'
      AND (
        leads.assigned_rep_id     = public.get_effective_user_id()
        OR leads.captured_by_user_id = public.get_effective_user_id()
      )
    )
  );

DO $$ BEGIN
  RAISE NOTICE 'Leads v2 installed: lead_kind enum + per-kind fields + conversion link columns + reserved trunk_show status + scoped RLS.';
END $$;
