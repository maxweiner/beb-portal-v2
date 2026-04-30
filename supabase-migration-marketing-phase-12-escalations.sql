-- ============================================================
-- Marketing Phase 12: escalation log
--
-- The /api/cron/marketing-escalations cron job uses this table to
-- dedup re-notifications: at most one escalation per (campaign,
-- escalation_type) per UTC day, regardless of how many times the
-- cron fires.
--
-- Safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS marketing_escalations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  escalation_type TEXT NOT NULL CHECK (escalation_type IN (
    'planning_approval',
    'proof_approval',
    'payment_request',
    'mark_paid'
  )),
  escalated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  escalated_day   DATE NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::DATE
);

-- Dedup constraint — one row per (campaign, type) per UTC day.
CREATE UNIQUE INDEX IF NOT EXISTS uq_marketing_escalations_per_day
  ON marketing_escalations(campaign_id, escalation_type, escalated_day);

CREATE INDEX IF NOT EXISTS idx_marketing_escalations_campaign
  ON marketing_escalations(campaign_id, escalated_at DESC);

ALTER TABLE marketing_escalations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketing_access_read ON marketing_escalations;
CREATE POLICY marketing_access_read ON marketing_escalations
  FOR SELECT USING (has_marketing_access());

-- No client-side write policy — only the cron route (service role) writes.

DO $$ BEGIN
  RAISE NOTICE 'marketing_escalations table installed.';
END $$;
