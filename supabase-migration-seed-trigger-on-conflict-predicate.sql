-- ── Hotfix: trigger ON CONFLICT must include partial-index WHERE
--
-- The previous migration added two partial unique indexes on
-- expense_reports:
--   (event_id, user_id)      WHERE event_id      IS NOT NULL
--   (trade_show_id, user_id) WHERE trade_show_id IS NOT NULL
--
-- Postgres requires the ON CONFLICT inference clause to ALSO carry
-- the partial index's WHERE predicate, otherwise it can't match the
-- index and you get the same error this fix is for:
--   "no unique or exclusion constraint matching the ON CONFLICT
--    specification"
--
-- Patch the trigger fn to include the predicate explicitly on each
-- branch.
--
-- Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION seed_expense_from_reservation() RETURNS TRIGGER AS $$
DECLARE
  v_category expense_category;
  v_report_id UUID;
  v_date DATE;
BEGIN
  IF NEW.buyer_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.amount IS NULL OR NEW.amount <= 0 THEN RETURN NEW; END IF;
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
    ON CONFLICT (event_id, user_id) WHERE event_id IS NOT NULL DO NOTHING;
    SELECT id INTO v_report_id
      FROM expense_reports
     WHERE event_id = NEW.event_id AND user_id = NEW.buyer_id;
  ELSE
    INSERT INTO expense_reports (trade_show_id, user_id)
    VALUES (NEW.trade_show_id, NEW.buyer_id)
    ON CONFLICT (trade_show_id, user_id) WHERE trade_show_id IS NOT NULL DO NOTHING;
    SELECT id INTO v_report_id
      FROM expense_reports
     WHERE trade_show_id = NEW.trade_show_id AND user_id = NEW.buyer_id;
  END IF;

  IF v_report_id IS NULL THEN RETURN NEW; END IF;

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
  RAISE NOTICE 'seed_expense_from_reservation: ON CONFLICT clauses now carry the partial-index WHERE predicate. Inbound webhook should stop hitting the trigger error.';
END $$;
