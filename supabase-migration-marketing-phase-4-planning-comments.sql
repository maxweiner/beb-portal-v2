-- ============================================================
-- Marketing Phase 4: planning review-comment columns
--
-- When an approver requests changes (rather than approving), they
-- attach a short note. We store the most recent reviewer note on
-- the details row so the planning page can display it back to
-- whoever resubmits.
--
-- Columns mirrored on postcard for Phase 5 — a single migration is
-- simpler than two.
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE vdp_campaign_details
  ADD COLUMN IF NOT EXISTS last_review_comment    TEXT NULL,
  ADD COLUMN IF NOT EXISTS last_review_comment_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS last_review_by         UUID NULL REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE postcard_campaign_details
  ADD COLUMN IF NOT EXISTS last_review_comment    TEXT NULL,
  ADD COLUMN IF NOT EXISTS last_review_comment_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS last_review_by         UUID NULL REFERENCES users(id) ON DELETE SET NULL;

DO $$ BEGIN
  RAISE NOTICE 'Marketing Phase 4 planning review columns installed.';
END $$;
