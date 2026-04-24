-- ============================================================
-- Per-brand opt-in flags for the morning report.
-- Replaces the single users.notify flag (which was producing
-- mixed-brand reports).
--
-- Backfill: anyone currently subscribed (notify=true) gets the BEB
-- report by default — that matches existing behavior since BEB was
-- the original brand. Liberty recipients opt in fresh from the new
-- "Report Recipients" admin page.
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_beb BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_liberty BOOLEAN NOT NULL DEFAULT false;

UPDATE users SET notify_beb = true WHERE notify = true;
