-- ============================================================
-- Customers module — PHASE 12: appointments → customers integration
--
-- Final phase. Wires the appointments table into the customers DB
-- so every booking automatically links to (or creates) a customer
-- record at the appointment's store. Aggregates (lifetime_
-- appointment_count, first/last_appointment_date) recompute on
-- every change. Daily engagement-scoring cron picks up tier
-- transitions overnight.
--
-- Design choices:
-- - Match logic is EXACT email OR EXACT phone only. The fuzzy
--   dedup_review_queue path is import-only — appointments need
--   zero friction (booked from kiosks, magic links, etc.).
-- - Triggers fire only when customer_email / customer_phone /
--   customer_name change so reminder-time updates don't spam.
-- - Aggregates count only confirmed + completed appointments —
--   cancelled / no_show shouldn't pull a customer's tier toward
--   "active".
-- - One-time backfill: any existing appointment without a
--   customer_id gets linked + the trigger creates new customer
--   rows when no match exists.
--
-- Safe to re-run.
-- ============================================================

-- ── 1. Add the FK column ───────────────────────────────────
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS customer_id UUID NULL
  REFERENCES customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_customer ON appointments(customer_id);

-- ── 2. Recompute-aggregates helper ─────────────────────────
-- Counts only confirmed + completed appointments. Sets count to
-- 0 and dates to NULL when no appointments remain (e.g., after
-- DELETE).
CREATE OR REPLACE FUNCTION customers_recompute_appt_aggregates(p_customer_id UUID)
RETURNS VOID AS $$
DECLARE
  v_cnt INTEGER;
  v_first DATE;
  v_last DATE;
BEGIN
  IF p_customer_id IS NULL THEN RETURN; END IF;
  SELECT count(*), min(appointment_date), max(appointment_date)
    INTO v_cnt, v_first, v_last
    FROM appointments
   WHERE customer_id = p_customer_id
     AND status IN ('confirmed', 'completed');
  UPDATE customers
     SET lifetime_appointment_count = coalesce(v_cnt, 0),
         first_appointment_date = v_first,
         last_appointment_date  = v_last
   WHERE id = p_customer_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 3. BEFORE INSERT/UPDATE trigger: link or create customer ──
CREATE OR REPLACE FUNCTION appointments_link_customer() RETURNS TRIGGER AS $$
DECLARE
  v_phone_norm TEXT;
  v_email_norm TEXT;
  v_match_id   UUID;
  v_first      TEXT;
  v_last       TEXT;
  v_space      INT;
BEGIN
  -- Skip if already linked.
  IF NEW.customer_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Normalize phone to 10 digits (mirror lib/customers/csv.ts logic).
  v_phone_norm := NULLIF(regexp_replace(coalesce(NEW.customer_phone, ''), '\D', '', 'g'), '');
  IF v_phone_norm IS NOT NULL AND length(v_phone_norm) = 11 AND substring(v_phone_norm, 1, 1) = '1' THEN
    v_phone_norm := substring(v_phone_norm, 2);
  END IF;
  IF v_phone_norm IS NOT NULL AND length(v_phone_norm) <> 10 THEN
    v_phone_norm := NULL;
  END IF;

  v_email_norm := NULLIF(lower(trim(coalesce(NEW.customer_email, ''))), '');

  -- Try exact email match first
  IF v_email_norm IS NOT NULL THEN
    SELECT id INTO v_match_id
      FROM customers
     WHERE store_id = NEW.store_id
       AND email_normalized = v_email_norm
       AND deleted_at IS NULL
     LIMIT 1;
  END IF;

  -- Then exact phone match
  IF v_match_id IS NULL AND v_phone_norm IS NOT NULL THEN
    SELECT id INTO v_match_id
      FROM customers
     WHERE store_id = NEW.store_id
       AND phone_normalized = v_phone_norm
       AND deleted_at IS NULL
     LIMIT 1;
  END IF;

  -- No match: create a fresh customer row from the appointment data.
  -- Split customer_name on first space; fall back to "(unknown)" for
  -- the half that's missing rather than leaving NOT NULL columns null.
  IF v_match_id IS NULL THEN
    IF NEW.customer_name IS NULL OR length(trim(NEW.customer_name)) = 0 THEN
      v_first := '(unknown)';
      v_last  := '(unknown)';
    ELSE
      v_space := position(' ' in trim(NEW.customer_name));
      IF v_space > 0 THEN
        v_first := substring(trim(NEW.customer_name), 1, v_space - 1);
        v_last  := trim(substring(trim(NEW.customer_name), v_space + 1));
        IF length(v_last) = 0 THEN v_last := '(unknown)'; END IF;
      ELSE
        v_first := trim(NEW.customer_name);
        v_last  := '(unknown)';
      END IF;
    END IF;

    INSERT INTO customers (
      store_id, first_name, last_name, phone, email, last_contact_date
    ) VALUES (
      NEW.store_id, v_first, v_last,
      NEW.customer_phone, NEW.customer_email,
      NEW.appointment_date
    )
    RETURNING id INTO v_match_id;

    -- Best-effort timeline event. NULL actor — the trigger has no
    -- auth.uid() context for kiosk / magic-link writes.
    INSERT INTO customer_events (customer_id, event_type, description, meta)
    VALUES (
      v_match_id, 'created',
      'Created from appointment',
      jsonb_build_object('source', 'appointment')
    );
  END IF;

  NEW.customer_id := v_match_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_appointments_link_customer ON appointments;
CREATE TRIGGER trg_appointments_link_customer
  BEFORE INSERT OR UPDATE OF customer_email, customer_phone, customer_name ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION appointments_link_customer();

-- ── 4. AFTER trigger: recompute aggregates for affected customers ──
CREATE OR REPLACE FUNCTION appointments_after_change() RETURNS TRIGGER AS $$
BEGIN
  -- Recompute for the new customer (if any) on INSERT or UPDATE
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.customer_id IS NOT NULL THEN
    PERFORM customers_recompute_appt_aggregates(NEW.customer_id);
  END IF;
  -- And the old customer when the FK switches (UPDATE) or row goes (DELETE)
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.customer_id IS NOT NULL THEN
    IF TG_OP = 'DELETE' OR OLD.customer_id IS DISTINCT FROM NEW.customer_id THEN
      PERFORM customers_recompute_appt_aggregates(OLD.customer_id);
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_appointments_after_change ON appointments;
CREATE TRIGGER trg_appointments_after_change
  AFTER INSERT OR UPDATE OR DELETE ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION appointments_after_change();

-- ── 5. One-time backfill ───────────────────────────────────
-- Touch every appointment without a customer_id so the BEFORE
-- trigger fires and populates customer_id (linking or creating).
-- Setting customer_phone = customer_phone is a no-op data change
-- but the BEFORE UPDATE OF customer_phone trigger still fires
-- because the column is named in SET.
UPDATE appointments
   SET customer_phone = customer_phone
 WHERE customer_id IS NULL;

-- Then recompute aggregates for every customer that got linked.
-- Single pass is plenty fast — bounded by # of distinct customers
-- with appointments.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT customer_id FROM appointments WHERE customer_id IS NOT NULL LOOP
    PERFORM customers_recompute_appt_aggregates(r.customer_id);
  END LOOP;
END $$;

DO $$ BEGIN
  RAISE NOTICE 'Phase 12 complete. Appointments → customers integration live; existing data backfilled.';
END $$;
