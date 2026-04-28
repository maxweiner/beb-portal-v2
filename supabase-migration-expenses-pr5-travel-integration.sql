-- ============================================================
-- Expenses & Invoicing PR 5: Travel module integration.
--
-- Auto-creates an expense_reports row for each (event, buyer) the
-- moment a reservation lands, and seeds a pre-filled expense for that
-- reservation (source='travel_module'). Idempotent — re-runnable; new
-- reservations on the same event/buyer add more line items, not
-- duplicate reports.
--
-- Behaviour rules (matches spec):
--   - Only flight / hotel / rental_car reservations seed expenses
--     (other types are travel-share-only — notes, etc.).
--   - Reservations with NULL buyer_id or amount <= 0 are skipped.
--   - Expense.vendor / amount / date come from the reservation;
--     notes carry the confirmation_number when present.
--   - Deleting a reservation removes the seeded expense IFF the
--     report is still in 'active' status AND the expense hasn't been
--     re-categorised by the user (source still 'travel_module').
--   - We do NOT auto-sync amount changes after the seed — too easy to
--     stomp on user edits. Amounts that change in Travel must be
--     reconciled manually in Expenses.
--
-- Bonus: adds a totals trigger on `expenses` so total_expenses /
-- grand_total on the parent report stay coherent regardless of
-- whether the change came from the trigger, the client, or a future
-- API route. Client-side recompute in PR2 still runs but is now
-- belt-and-suspenders.
--
-- Safe to re-run.
-- ============================================================

-- ── 1. Link column on expenses ────────────────────────────
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS source_reservation_id UUID REFERENCES travel_reservations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_source_reservation
  ON expenses(source_reservation_id) WHERE source_reservation_id IS NOT NULL;

-- ── 2. Recompute helper ───────────────────────────────────
CREATE OR REPLACE FUNCTION recompute_expense_report_totals(p_report_id UUID)
RETURNS VOID AS $$
DECLARE
  v_total NUMERIC(12,2);
  v_comp  NUMERIC(12,2);
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO v_total FROM expenses WHERE expense_report_id = p_report_id;
  SELECT total_compensation INTO v_comp FROM expense_reports WHERE id = p_report_id;
  UPDATE expense_reports
    SET total_expenses = v_total,
        grand_total    = v_total + COALESCE(v_comp, 0)
    WHERE id = p_report_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 3. Trigger on expenses to keep report totals fresh ───
CREATE OR REPLACE FUNCTION touch_expense_report_totals() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recompute_expense_report_totals(OLD.expense_report_id);
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' AND OLD.expense_report_id IS DISTINCT FROM NEW.expense_report_id THEN
    PERFORM recompute_expense_report_totals(OLD.expense_report_id);
    PERFORM recompute_expense_report_totals(NEW.expense_report_id);
    RETURN NEW;
  ELSE
    PERFORM recompute_expense_report_totals(NEW.expense_report_id);
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_expense_report_totals ON expenses;
CREATE TRIGGER trg_touch_expense_report_totals
AFTER INSERT OR UPDATE OF amount, expense_report_id OR DELETE ON expenses
FOR EACH ROW EXECUTE FUNCTION touch_expense_report_totals();

-- ── 4. Seed an expense from a reservation (trigger fn) ───
CREATE OR REPLACE FUNCTION seed_expense_from_reservation() RETURNS TRIGGER AS $$
DECLARE
  v_category expense_category;
  v_report_id UUID;
  v_date DATE;
BEGIN
  IF NEW.buyer_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.amount IS NULL OR NEW.amount <= 0 THEN RETURN NEW; END IF;

  -- Map reservation type → expense category. Anything else: skip.
  CASE NEW.type
    WHEN 'flight'     THEN v_category := 'flight';
    WHEN 'hotel'      THEN v_category := 'hotel';
    WHEN 'rental_car' THEN v_category := 'rental_car';
    ELSE RETURN NEW;
  END CASE;

  -- Best-effort date pick — fall back to today if all reservation
  -- date fields are NULL.
  v_date := COALESCE(
    (NEW.departure_at)::date,
    NEW.check_in,
    CURRENT_DATE
  );

  -- Get-or-create the (event, user) report.
  INSERT INTO expense_reports (event_id, user_id)
  VALUES (NEW.event_id, NEW.buyer_id)
  ON CONFLICT (event_id, user_id) DO NOTHING;

  SELECT id INTO v_report_id
  FROM expense_reports
  WHERE event_id = NEW.event_id AND user_id = NEW.buyer_id;
  IF v_report_id IS NULL THEN RETURN NEW; END IF;

  -- Idempotency: skip if we've already seeded an expense for this
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

DROP TRIGGER IF EXISTS trg_seed_expense_from_reservation ON travel_reservations;
CREATE TRIGGER trg_seed_expense_from_reservation
AFTER INSERT ON travel_reservations
FOR EACH ROW EXECUTE FUNCTION seed_expense_from_reservation();

-- ── 5. Cleanup expense when reservation is deleted ───────
CREATE OR REPLACE FUNCTION cleanup_expense_for_deleted_reservation() RETURNS TRIGGER AS $$
BEGIN
  -- Only nuke seeded expenses on still-active reports. Once submitted /
  -- approved, the expense becomes part of an approved record and is
  -- left alone (admin can clean up manually if needed).
  DELETE FROM expenses e
  USING expense_reports r
  WHERE e.source_reservation_id = OLD.id
    AND e.expense_report_id = r.id
    AND e.source = 'travel_module'
    AND r.status = 'active';
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_cleanup_expense_on_reservation_delete ON travel_reservations;
CREATE TRIGGER trg_cleanup_expense_on_reservation_delete
BEFORE DELETE ON travel_reservations
FOR EACH ROW EXECUTE FUNCTION cleanup_expense_for_deleted_reservation();

-- ── 6. Backfill existing reservations ────────────────────
-- Two pure-SQL passes: ensure reports exist, then seed expenses.
-- Skip rows already covered (idempotent — safe to re-run the migration).
INSERT INTO expense_reports (event_id, user_id)
SELECT DISTINCT res.event_id, res.buyer_id
FROM travel_reservations res
WHERE res.buyer_id IS NOT NULL
  AND res.amount IS NOT NULL AND res.amount > 0
  AND res.type IN ('flight', 'hotel', 'rental_car')
ON CONFLICT (event_id, user_id) DO NOTHING;

INSERT INTO expenses (
  expense_report_id, category, vendor, amount, expense_date,
  notes, source, source_reservation_id
)
SELECT
  r.id,
  CASE res.type
    WHEN 'flight'     THEN 'flight'::expense_category
    WHEN 'hotel'      THEN 'hotel'::expense_category
    WHEN 'rental_car' THEN 'rental_car'::expense_category
  END,
  NULLIF(res.vendor, ''),
  res.amount,
  COALESCE(res.departure_at::date, res.check_in, CURRENT_DATE),
  CASE WHEN NULLIF(res.confirmation_number, '') IS NOT NULL
       THEN 'Confirmation: ' || res.confirmation_number ELSE NULL END,
  'travel_module',
  res.id
FROM travel_reservations res
JOIN expense_reports r ON r.event_id = res.event_id AND r.user_id = res.buyer_id
WHERE res.buyer_id IS NOT NULL
  AND res.amount IS NOT NULL AND res.amount > 0
  AND res.type IN ('flight', 'hotel', 'rental_car')
  AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.source_reservation_id = res.id);

-- ── 7. Verify ────────────────────────────────────────────
DO $$
DECLARE
  seeded INT;
  reports INT;
BEGIN
  SELECT COUNT(*) INTO seeded FROM expenses WHERE source_reservation_id IS NOT NULL;
  SELECT COUNT(*) INTO reports FROM expense_reports;
  RAISE NOTICE 'Travel integration installed. Reports: %, expenses seeded from travel_reservations: %', reports, seeded;
END $$;
