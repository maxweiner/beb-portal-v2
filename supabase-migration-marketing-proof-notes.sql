-- ============================================================
-- Per-upload + overall notes for the marketing team's proof step.
--
-- marketing_proofs.upload_note — set at upload time. One short note
-- per proof version describing what's in this batch ("v3, fixed
-- offer headline" / "front + back, final palette"). Optional.
--
-- marketing_campaigns.marketing_team_notes — campaign-wide note from
-- the marketing team. Survives across proof versions; meant for
-- broader context ("approvers: please review front before back —
-- back is just our standard template"). Optional.
--
-- Both are surfaced on the in-portal Proofing section. RLS already
-- lets the marketing team write marketing_proofs at upload time and
-- marketing_campaigns generally (the buyer-fields-guard trigger only
-- blocks the budget + team_notified_at columns).
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE marketing_proofs
  ADD COLUMN IF NOT EXISTS upload_note TEXT NULL;

ALTER TABLE marketing_campaigns
  ADD COLUMN IF NOT EXISTS marketing_team_notes TEXT NULL;

COMMENT ON COLUMN marketing_proofs.upload_note IS
  'Optional note written by the marketing team at upload time describing the batch (e.g. "v2, fixed offer headline"). Surfaced on the proof card and emailed to approvers in the proof-review notification.';
COMMENT ON COLUMN marketing_campaigns.marketing_team_notes IS
  'Optional campaign-wide note from the marketing team — broader than per-version upload notes. Edits autosave on the Proofing section.';

DO $$ BEGIN
  RAISE NOTICE 'marketing_proofs.upload_note + marketing_campaigns.marketing_team_notes installed.';
END $$;
