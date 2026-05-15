-- ============================================================
-- Travel → Expense auto-seed fix (one-shot)
--
-- Problem: travel reservations aren't auto-creating expense_reports
-- + expenses rows. Symptom: a buyer adds a flight/hotel/rental in
-- Travel Share with buyer_id + amount, and nothing appears in their
-- Expenses tab for that event.
--
-- Root cause: PR5's trigger uses
--     INSERT ... ON CONFLICT (event_id, user_id) DO NOTHING
-- but the partial unique index `expense_reports_event_user_uniq`
-- was never installed in prod (its companion hotfix migration
-- supabase-migration-expense-reports-unique-and-trigger-fix.sql
-- was never applied). Every trigger fire — and the PR5 backfill —
-- bombs with 42P10:
--     "there is no unique or exclusion constraint matching the
--      ON CONFLICT specification"
--
-- This migration is a single self-contained fix. It:
--   1. Installs the partial unique index on (event_id, user_id)
--      and the matching one on (trade_show_id, user_id).
--   2. Re-installs the seed_expense_from_reservation trigger
--      (event-OR-trade-show aware version).
--   3. Backfills expense_reports for every existing travel
--      reservation that should have produced one but didn't.
--   4. Backfills expenses rows for every reservation whose seed
--      hasn't been created yet (uses source_reservation_id to
--      dedupe so re-runs are safe).
--
-- Safe to re-run. Idempotent.
-- ============================================================

-- ── 1. Partial unique indexes — required for ON CONFLICT ──

-- Defensive: drop any legacy plain UNIQUE (event_id,user_id) — its
-- NULL semantics conflict with the partial-index approach.
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
  ON public.expense_reports (event_id, user_id)
  WHERE event_id IS NOT NULL;

-- Trade-show variant — only created if the column exists yet.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'expense_reports'
       AND column_name  = 'trade_show_id'
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS expense_reports_trade_show_user_uniq
      ON public.expense_reports (trade_show_id, user_id)
      WHERE trade_show_id IS NOT NULL;
  END IF;
END $$;

-- ── 2. Trigger — event-OR-trade-show aware ──
CREATE OR REPLACE FUNCTION seed_expense_from_reservation() RETURNS TRIGGER AS $$
DECLARE
  v_category expense_category;
  v_report_id UUID;
  v_date DATE;
  v_has_trade_show BOOLEAN;
BEGIN
  IF NEW.buyer_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.amount IS NULL OR NEW.amount <= 0 THEN RETURN NEW; END IF;

  -- Does this install have trade_show_id wired in yet?
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'expense_reports'
       AND column_name  = 'trade_show_id'
  ) INTO v_has_trade_show;

  -- Need either an event or trade show to attach to.
  IF NEW.event_id IS NULL AND (NOT v_has_trade_show OR NEW.trade_show_id IS NULL) THEN
    RETURN NEW;
  END IF;

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
    -- WHERE clause mirrors the partial unique index predicate —
    -- required for ON CONFLICT to infer a partial index as arbiter.
    INSERT INTO expense_reports (event_id, user_id)
    VALUES (NEW.event_id, NEW.buyer_id)
    ON CONFLICT (event_id, user_id) WHERE event_id IS NOT NULL DO NOTHING;
    SELECT id INTO v_report_id
      FROM expense_reports
     WHERE event_id = NEW.event_id AND user_id = NEW.buyer_id;
  ELSE
    -- trade-show side (only reachable when v_has_trade_show)
    EXECUTE 'INSERT INTO expense_reports (trade_show_id, user_id)
             VALUES ($1, $2)
             ON CONFLICT (trade_show_id, user_id) WHERE trade_show_id IS NOT NULL DO NOTHING'
      USING NEW.trade_show_id, NEW.buyer_id;
    EXECUTE 'SELECT id FROM expense_reports
              WHERE trade_show_id = $1 AND user_id = $2'
      INTO v_report_id
      USING NEW.trade_show_id, NEW.buyer_id;
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

-- Wire the trigger on the table (in case PR5 never did).
DROP TRIGGER IF EXISTS trg_seed_expense_from_reservation ON travel_reservations;
CREATE TRIGGER trg_seed_expense_from_reservation
  AFTER INSERT OR UPDATE ON travel_reservations
  FOR EACH ROW EXECUTE FUNCTION seed_expense_from_reservation();

-- ── 3. Backfill expense_reports ──
-- For every event-bound travel reservation with a buyer + amount,
-- guarantee an expense_reports row exists.
INSERT INTO expense_reports (event_id, user_id)
SELECT DISTINCT res.event_id, res.buyer_id
  FROM travel_reservations res
 WHERE res.buyer_id IS NOT NULL
   AND res.event_id IS NOT NULL
   AND res.amount IS NOT NULL
   AND res.amount > 0
   AND res.type IN ('flight', 'hotel', 'rental_car')
   AND NOT EXISTS (
     SELECT 1 FROM expense_reports er
      WHERE er.event_id = res.event_id
        AND er.user_id  = res.buyer_id
   );

-- ── 4. Backfill expenses rows ──
-- For every event-bound reservation that hasn't been seeded as an
-- expense yet, create the expense row. Joins on the just-ensured
-- expense_reports row.
INSERT INTO expenses (
  expense_report_id, category, vendor, amount, expense_date,
  notes, source, source_reservation_id
)
SELECT
  er.id,
  CASE res.type
    WHEN 'flight'     THEN 'flight'::expense_category
    WHEN 'hotel'      THEN 'hotel'::expense_category
    WHEN 'rental_car' THEN 'rental_car'::expense_category
  END,
  NULLIF(res.vendor, ''),
  res.amount,
  COALESCE((res.departure_at)::date, res.check_in, CURRENT_DATE),
  CASE WHEN NULLIF(res.confirmation_number, '') IS NOT NULL
       THEN 'Confirmation: ' || res.confirmation_number
       ELSE NULL END,
  'travel_module',
  res.id
FROM travel_reservations res
JOIN expense_reports er
  ON er.event_id = res.event_id
 AND er.user_id  = res.buyer_id
WHERE res.buyer_id IS NOT NULL
  AND res.event_id IS NOT NULL
  AND res.amount IS NOT NULL
  AND res.amount > 0
  AND res.type IN ('flight', 'hotel', 'rental_car')
  AND NOT EXISTS (
    SELECT 1 FROM expenses e WHERE e.source_reservation_id = res.id
  );

DO $$ BEGIN
  RAISE NOTICE 'travel→expense seed fix applied: partial unique index installed, trigger wired, backfill complete.';
END $$;
