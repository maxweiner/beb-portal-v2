-- ── Hotfix: inbound travel webhook 500 + trade-show expenses ──
-- Two changes:
--
-- 1. The seed_expense_from_reservation trigger does:
--      INSERT INTO expense_reports (...) ON CONFLICT (event_id, user_id) DO NOTHING;
--    But there was no UNIQUE constraint on (event_id, user_id), so
--    every inbound hotel/flight reservation with buyer_id+amount>0
--    bombed the webhook with:
--      "there is no unique or exclusion constraint matching the
--       ON CONFLICT specification"
--
-- 2. After the trade-show matcher landed, a reservation can have
--    trade_show_id set instead of event_id. Trade shows should get
--    their own per-(trade_show, user) expense report, parallel to
--    the per-(event, user) one — so add trade_show_id to
--    expense_reports and let the trigger seed either side.
--
-- Schema choice: two partial unique indexes (one per parent col)
-- rather than a single composite. PG treats NULLs as distinct in
-- ordinary unique constraints, so a single (event_id,trade_show_id,
-- user_id) unique would let unbounded duplicates of the all-null
-- rows in. Partial indexes scoped to the non-null side avoid that.
--
-- Safe to re-run.
-- ============================================================

-- 1. Add trade_show_id to expense_reports.
ALTER TABLE public.expense_reports
  ADD COLUMN IF NOT EXISTS trade_show_id UUID NULL REFERENCES public.trade_shows(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_expense_reports_trade_show
  ON public.expense_reports (trade_show_id) WHERE trade_show_id IS NOT NULL;

-- A report is for an event OR a trade show, never both. (Both null
-- is allowed for now — historical/freeform reports may exist.)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.expense_reports'::regclass
       AND conname  = 'expense_reports_event_xor_trade_show'
  ) THEN
    ALTER TABLE public.expense_reports
      DROP CONSTRAINT expense_reports_event_xor_trade_show;
  END IF;
END $$;
ALTER TABLE public.expense_reports
  ADD CONSTRAINT expense_reports_event_xor_trade_show
  CHECK (event_id IS NULL OR trade_show_id IS NULL);

-- 2. Partial unique indexes so ON CONFLICT works on whichever
--    parent the trigger is targeting.
--
--    Drop any old plain UNIQUE (event_id,user_id) first — its NULL
--    semantics conflict with the partial-index approach.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.expense_reports'::regclass
       AND conname  = 'expense_reports_event_user_unique'
  ) THEN
    ALTER TABLE public.expense_reports
      DROP CONSTRAINT expense_reports_event_user_unique;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS expense_reports_event_user_uniq
  ON public.expense_reports (event_id, user_id) WHERE event_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS expense_reports_trade_show_user_uniq
  ON public.expense_reports (trade_show_id, user_id) WHERE trade_show_id IS NOT NULL;

-- 3. Patch the trigger to seed the right report based on which
--    parent the reservation is attached to.
CREATE OR REPLACE FUNCTION seed_expense_from_reservation() RETURNS TRIGGER AS $$
DECLARE
  v_category expense_category;
  v_report_id UUID;
  v_date DATE;
BEGIN
  IF NEW.buyer_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.amount IS NULL OR NEW.amount <= 0 THEN RETURN NEW; END IF;
  -- Need either an event or trade show to attach the report to.
  IF NEW.event_id IS NULL AND NEW.trade_show_id IS NULL THEN RETURN NEW; END IF;

  CASE NEW.type
    WHEN 'flight'     THEN v_category := 'flight';
    WHEN 'hotel'      THEN v_category := 'hotel';
    WHEN 'rental_car' THEN v_category := 'rental_car';
    ELSE RETURN NEW;
  END CASE;

  v_date := COALESCE(
    (NEW.departure_at)::date,
    NEW.check_in,
    CURRENT_DATE
  );

  IF NEW.event_id IS NOT NULL THEN
    INSERT INTO expense_reports (event_id, user_id)
    VALUES (NEW.event_id, NEW.buyer_id)
    ON CONFLICT (event_id, user_id) DO NOTHING;
    SELECT id INTO v_report_id
      FROM expense_reports
     WHERE event_id = NEW.event_id AND user_id = NEW.buyer_id;
  ELSE
    INSERT INTO expense_reports (trade_show_id, user_id)
    VALUES (NEW.trade_show_id, NEW.buyer_id)
    ON CONFLICT (trade_show_id, user_id) DO NOTHING;
    SELECT id INTO v_report_id
      FROM expense_reports
     WHERE trade_show_id = NEW.trade_show_id AND user_id = NEW.buyer_id;
  END IF;

  IF v_report_id IS NULL THEN RETURN NEW; END IF;

  -- Idempotent: skip if we've already seeded an expense for this
  -- reservation. Lets the trigger fire safely on bulk re-imports.
  IF EXISTS (SELECT 1 FROM expenses WHERE source_reservation_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  INSERT INTO expenses (
    expense_report_id, category, vendor, amount, expense_date,
    notes, source, source_reservation_id
  ) VALUES (
    v_report_id, v_category,
    NULLIF(NEW.vendor, ''),
    NEW.amount, v_date,
    CASE WHEN NULLIF(NEW.confirmation_number, '') IS NOT NULL
         THEN 'Confirmation: ' || NEW.confirmation_number
         ELSE NULL END,
    'travel_module', NEW.id
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$ BEGIN
  RAISE NOTICE 'expense_reports.trade_show_id + partial unique indexes installed; seed trigger now handles both event- and trade-show-bound reservations.';
END $$;
