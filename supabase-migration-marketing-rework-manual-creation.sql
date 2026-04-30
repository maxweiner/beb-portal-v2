-- ============================================================
-- Marketing rework: manual campaign creation
--
-- Removes the AFTER INSERT trigger on events that auto-spawned a
-- VDP + Postcard campaign for every new event. Going forward,
-- campaigns are created explicitly via the "+ New Campaign" button
-- (or the post-event-create prompt).
--
-- Also wipes every existing campaign — these were all auto-created
-- placeholders and are confirmed (per user) to be test data.
--
-- Cascades from marketing_campaigns clean up:
--   vdp_campaign_details, vdp_zip_codes,
--   postcard_campaign_details, postcard_uploads,
--   marketing_proofs, marketing_proof_comments,
--   marketing_campaign_artifacts,
--   magic_link_tokens,
--   marketing_escalations
--
-- Storage buckets (marketing-proofs, marketing-pdfs) are NOT touched
-- here — Supabase blocks SQL DELETE on storage.objects. Run the
-- companion script (scripts/wipe-marketing-storage.ts) once after
-- this migration to clear orphan files.
--
-- compute_mail_by_date() helper is RETAINED — the manual-create API
-- uses it to set mail_by_date when a campaign is created.
--
-- Safe to re-run.
-- ============================================================

DROP TRIGGER IF EXISTS trg_marketing_auto_create ON events;
DROP FUNCTION IF EXISTS marketing_auto_create_campaigns();

-- Wipe (cascades clean up everything tied to a campaign)
DELETE FROM marketing_campaigns;

DO $$ BEGIN
  RAISE NOTICE 'Auto-create trigger removed; marketing_campaigns wiped. Run scripts/wipe-marketing-storage.ts to clear bucket orphans.';
END $$;
