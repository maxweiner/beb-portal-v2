-- ── Buying-event spiffs ──────────────────────────────────────
-- Store sales staff earn a flat $X spiff for every appointment
-- they booked (via their personal QR/booking link) that the
-- customer actually showed up for (appointments.status='completed').
--
-- This migration adds:
--   1. events.spiff_amount_per_show — per-event override of the
--      default $10/show. Partners can set this higher for special
--      pushes ("$20 spiff this event").
--   2. buying_event_spiff_payouts — one row per (event, employee)
--      payout. Earned counts are computed on the fly from
--      appointments; the payouts table only records what was
--      actually paid out, snapshotting amount + employee name so
--      history survives later edits or deletions.
--
-- RLS:
--   - SELECT: admin/superadmin/partner can read all.
--   - INSERT/UPDATE/DELETE: partner-only (matches expense-report
--     templates / financials pattern).
--
-- Safe to re-run.
-- ============================================================

-- ── 1. events.spiff_amount_per_show ──────────────────────────
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS spiff_amount_per_show NUMERIC(10,2) NOT NULL DEFAULT 10.00;

COMMENT ON COLUMN public.events.spiff_amount_per_show IS
  'Dollar amount paid to each store staff member per show-up appointment they booked. Default $10. Editable per event for special pushes.';

-- ── 2. buying_event_spiff_payouts table ──────────────────────
CREATE TABLE IF NOT EXISTS public.buying_event_spiff_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,

  -- Earner. SET NULL on delete so payout history survives if a
  -- store later removes the employee record.
  appointment_employee_id UUID REFERENCES public.appointment_employees(id) ON DELETE SET NULL,
  -- Denormalized snapshot of the employee's name at payout time
  -- so the row is meaningful even if the FK is later nulled.
  employee_name TEXT NOT NULL,

  -- Snapshot of the rate that was in effect when paid, multiplied
  -- by the count, so changing events.spiff_amount_per_show later
  -- doesn't rewrite history.
  amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  appointments_count INTEGER NOT NULL CHECK (appointments_count >= 0),

  notes TEXT,

  paid_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  paid_by_name TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One payout per employee per event.
  UNIQUE (event_id, appointment_employee_id)
);

CREATE INDEX IF NOT EXISTS idx_spiff_payouts_event
  ON public.buying_event_spiff_payouts (event_id);

COMMENT ON TABLE  public.buying_event_spiff_payouts IS
  'One row per (event, store-employee) spiff that has been paid. Earned counts are computed on the fly from appointments; this table only records actual payouts.';

-- ── 3. RLS ───────────────────────────────────────────────────
ALTER TABLE public.buying_event_spiff_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "buying_event_spiff_payouts_select" ON public.buying_event_spiff_payouts;
CREATE POLICY "buying_event_spiff_payouts_select"
  ON public.buying_event_spiff_payouts
  FOR SELECT
  USING (
    public.get_my_role() IN ('admin','superadmin')
    OR EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.email = auth.jwt()->>'email' AND u.is_partner IS TRUE
    )
  );

DROP POLICY IF EXISTS "buying_event_spiff_payouts_partner_write" ON public.buying_event_spiff_payouts;
CREATE POLICY "buying_event_spiff_payouts_partner_write"
  ON public.buying_event_spiff_payouts
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.email = auth.jwt()->>'email' AND u.is_partner IS TRUE
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.email = auth.jwt()->>'email' AND u.is_partner IS TRUE
    )
  );

DO $$ BEGIN
  RAISE NOTICE 'buying_event_spiff_payouts installed; events.spiff_amount_per_show default 10.00.';
END $$;
