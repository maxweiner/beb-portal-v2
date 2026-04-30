-- ============================================================
-- Marketing Phase 3: campaign auto-creation + mail-by computation
--
-- 1. compute_mail_by_date(start_date, flow_type) helper — reads the
--    per-flow lead-time setting (with spec defaults as fallback).
-- 2. AFTER INSERT trigger on events → auto-creates one VDP and one
--    Postcard campaign per new event (admin can delete one if not
--    needed).
-- 3. One-time backfill for existing events with start_date >= today.
--
-- The trigger function is SECURITY DEFINER because event creators
-- (admins) typically don't have marketing_access — without DEFINER the
-- INSERT into marketing_campaigns would fail RLS.
--
-- Safe to re-run.
-- ============================================================

-- ── 1. Mail-by date helper ──────────────────────────────────
CREATE OR REPLACE FUNCTION compute_mail_by_date(
  p_start_date DATE,
  p_flow       marketing_flow_type
)
RETURNS DATE AS $$
DECLARE
  lead_days   INTEGER;
  setting_key TEXT;
  raw_value   TEXT;
BEGIN
  IF p_start_date IS NULL THEN RETURN NULL; END IF;

  setting_key := CASE p_flow
    WHEN 'vdp'      THEN 'marketing_vdp_lead_days'
    WHEN 'postcard' THEN 'marketing_postcard_lead_days'
    ELSE NULL
  END;
  IF setting_key IS NULL THEN RETURN NULL; END IF;

  -- Settings.value may be plain text or jsonb — strip any quotes
  -- before casting so '14' / '"14"' / 14 all work.
  SELECT value::TEXT INTO raw_value FROM settings WHERE key = setting_key;
  BEGIN
    lead_days := REPLACE(COALESCE(raw_value, ''), '"', '')::INTEGER;
  EXCEPTION WHEN OTHERS THEN
    lead_days := NULL;
  END;
  IF lead_days IS NULL THEN
    -- Spec defaults
    lead_days := CASE p_flow WHEN 'vdp' THEN 14 WHEN 'postcard' THEN 10 ELSE 0 END;
  END IF;

  RETURN p_start_date - lead_days;
END;
$$ LANGUAGE plpgsql STABLE;

-- ── 2. AFTER INSERT trigger on events ───────────────────────
CREATE OR REPLACE FUNCTION marketing_auto_create_campaigns()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  INSERT INTO marketing_campaigns (event_id, flow_type, mail_by_date)
  VALUES
    (NEW.id, 'vdp',      compute_mail_by_date(NEW.start_date, 'vdp')),
    (NEW.id, 'postcard', compute_mail_by_date(NEW.start_date, 'postcard'))
  ON CONFLICT (event_id, flow_type) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_marketing_auto_create ON events;
CREATE TRIGGER trg_marketing_auto_create
  AFTER INSERT ON events
  FOR EACH ROW EXECUTE FUNCTION marketing_auto_create_campaigns();

-- ── 3. Backfill existing future events ──────────────────────
-- Past events don't need campaigns (the marketing window is closed),
-- so scope to start_date >= today. Admin can manually create campaigns
-- for past events later if needed.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT id, start_date FROM events
    WHERE start_date IS NOT NULL AND start_date >= CURRENT_DATE
  LOOP
    INSERT INTO marketing_campaigns (event_id, flow_type, mail_by_date)
    VALUES
      (r.id, 'vdp',      compute_mail_by_date(r.start_date, 'vdp')),
      (r.id, 'postcard', compute_mail_by_date(r.start_date, 'postcard'))
    ON CONFLICT (event_id, flow_type) DO NOTHING;
  END LOOP;
END $$;

DO $$ BEGIN
  RAISE NOTICE 'Marketing Phase 3 trigger installed + backfilled future events.';
END $$;
