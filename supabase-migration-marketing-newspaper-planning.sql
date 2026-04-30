-- ============================================================
-- Marketing: newspaper planning details table
--
-- Mirrors the shape of vdp_campaign_details + postcard_campaign_details.
-- Captures publication_name (the single planning input newspaper needs)
-- + the same submit / approve / review-comment columns used by VDP and
-- Postcard so the same approval API can handle all three flow types.
--
-- Also extends compute_mail_by_date() to honor a newspaper lead-time
-- setting (defaults to 7 days; admins can change via Settings → Lead
-- Times if/when newspaper-specific timing matters).
--
-- Safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS newspaper_campaign_details (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id            UUID NOT NULL UNIQUE REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  publication_name       TEXT NULL,
  submitted_at           TIMESTAMPTZ NULL,
  submitted_by           UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  approved_at            TIMESTAMPTZ NULL,
  approved_by            UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  last_review_comment    TEXT NULL,
  last_review_comment_at TIMESTAMPTZ NULL,
  last_review_by         UUID NULL REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE newspaper_campaign_details ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketing_access_rw ON newspaper_campaign_details;
CREATE POLICY marketing_access_rw ON newspaper_campaign_details
  FOR ALL USING (has_marketing_access()) WITH CHECK (has_marketing_access());

-- Lead-time default for newspaper. Editable via Settings → Lead Times
-- once the panel learns about this key (one-line follow-up).
INSERT INTO settings (key, value)
VALUES ('marketing_newspaper_lead_days', '7')
ON CONFLICT (key) DO NOTHING;

-- Extend compute_mail_by_date to recognize newspaper alongside VDP/Postcard.
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
    WHEN 'vdp'       THEN 'marketing_vdp_lead_days'
    WHEN 'postcard'  THEN 'marketing_postcard_lead_days'
    WHEN 'newspaper' THEN 'marketing_newspaper_lead_days'
    ELSE NULL
  END;
  IF setting_key IS NULL THEN RETURN NULL; END IF;

  SELECT value::TEXT INTO raw_value FROM settings WHERE key = setting_key;
  BEGIN
    lead_days := REPLACE(COALESCE(raw_value, ''), '"', '')::INTEGER;
  EXCEPTION WHEN OTHERS THEN
    lead_days := NULL;
  END;
  IF lead_days IS NULL THEN
    lead_days := CASE p_flow
      WHEN 'vdp'       THEN 14
      WHEN 'postcard'  THEN 10
      WHEN 'newspaper' THEN 7
      ELSE 0
    END;
  END IF;

  RETURN p_start_date - lead_days;
END;
$$ LANGUAGE plpgsql STABLE;

DO $$ BEGIN
  RAISE NOTICE 'newspaper_campaign_details + lead-time installed.';
END $$;
