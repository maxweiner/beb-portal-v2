-- ── Trade show per-day hours ──────────────────────────────────
-- Trade shows had no per-day hours before — slots were created in
-- a free-form way within the start/end_date window. To match the
-- trunk-show pattern (and to drive the "auto-fill 30-min slots
-- per assigned rep per day" generator), add a sibling hours table.
--
-- Each row is one bookable day: open_time → close_time. The "Fill
-- all days × reps" flow reads these to know how many slots to mint.
-- Days the show is dark just don't get a row.
--
-- Safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.trade_show_hours (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_show_id   UUID NOT NULL REFERENCES public.trade_shows(id) ON DELETE CASCADE,
  show_date       DATE NOT NULL,
  open_time       TIME NOT NULL,
  close_time      TIME NOT NULL CHECK (close_time > open_time),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (trade_show_id, show_date)
);
CREATE INDEX IF NOT EXISTS idx_trade_show_hours_show
  ON public.trade_show_hours (trade_show_id, show_date);

ALTER TABLE public.trade_show_hours ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trade_show_hours_read ON public.trade_show_hours;
CREATE POLICY trade_show_hours_read ON public.trade_show_hours
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'superadmin', 'sales_rep', 'trunk_admin')
    OR public.is_my_partner()
  );

DROP POLICY IF EXISTS trade_show_hours_write ON public.trade_show_hours;
CREATE POLICY trade_show_hours_write ON public.trade_show_hours
  FOR ALL TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
  )
  WITH CHECK (
    public.get_my_role() IN ('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
  );

DO $$ BEGIN
  RAISE NOTICE 'trade_show_hours installed. Edit per-day hours on the trade-show detail page; "Fill all days" auto-generates per-rep slots from these.';
END $$;
